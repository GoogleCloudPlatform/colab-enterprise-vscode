/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import vscode from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { log } from '../common/logging/logger';
import { AUTHORIZATION_HEADER } from '../workbench/headers';

/** How long before a token expires to refresh it. */
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes.

/**
 * How long to wait before retrying a refresh that failed.
 *
 * A static delay is sufficient here: refreshes are infrequent and a failed
 * refresh simply needs another attempt before the current token expires.
 */
const RETRY_DELAY_MS = 30 * 1000; // 30 seconds.

/** The smallest delay before a scheduled refresh, guarding against past dates. */
const MIN_REFRESH_DELAY_MS = 100;

/**
 * Assumed access-token lifetime when the OAuth client does not report an
 * expiry. Google access tokens live ~1 hour.
 */
const DEFAULT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

/** An access token together with the time at which it expires. */
interface AccessToken {
  readonly token: string;
  readonly expiry: Date;
}

/**
 * The mutable connection state a {@link ConnectionRefresher} keeps fresh.
 *
 * A refresh updates {@link token} and {@link tokenExpiry} and rewrites the
 * `Authorization` entry of {@link headers} in place.
 */
export interface RefreshableConnection {
  token: string;
  tokenExpiry: Date;
  headers: Record<string, string>;
}

/** A watched connection and the timer for its next scheduled refresh. */
interface ScheduledConnectionRefresh {
  readonly connection: RefreshableConnection;
  nextRefreshTimer?: ReturnType<typeof setTimeout>;
}

/**
 * Keeps the access token of one or more Workbench server connections fresh for
 * the lifetime of the extension.
 *
 * Every Workbench server has its own connection info (token and expiry), so
 * refreshes are tracked per server, keyed by server id. The VS Code Jupyter
 * extension caches each connection's authorization headers by reference and
 * re-reads them on every REST request and WebSocket handshake, so a refresh
 * simply updates the connection in place; no re-resolution is required
 * (b/533128081).
 *
 * Modeled on the Colab VS Code extension's `ConnectionRefresher`, each server's
 * refresh is scheduled a fixed buffer *before* its token expires (rather than
 * polling on a fixed interval), rescheduled from each new token's expiry, and
 * retried on failure.
 */
export class ConnectionRefresher implements vscode.Disposable {
  private readonly refreshByServerId = new Map<
    string,
    ScheduledConnectionRefresh
  >();
  private isDisposed = false;

  /**
   * Creates a new ConnectionRefresher.
   *
   * @param vs - The VS Code API instance.
   * @param authClient - The OAuth2 client whose credentials expiry drives the
   * refresh schedule.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly authClient: OAuth2Client,
  ) {}

  /**
   * Stamps a fresh token into the given connection and keeps it fresh for the
   * server identified by `serverId`. Calling this again for the same server
   * replaces the previous refresh schedule.
   *
   * @param serverId - The id of the server this connection belongs to.
   * @param connection - The connection to keep authenticated (updated in
   * place).
   */
  async refresh(
    serverId: string,
    connection: RefreshableConnection,
  ): Promise<void> {
    this.guardNotDisposed();
    const accessToken = await this.fetchAccessToken();
    writeTokenToConnection(connection, accessToken);
    this.cancelScheduledRefresh(serverId);
    this.refreshByServerId.set(serverId, { connection });
    this.scheduleNextRefresh(serverId, delayUntilRefresh(accessToken.expiry));
  }

  private async fetchAccessToken(): Promise<AccessToken> {
    // getOrCreateSession refreshes the token if it is near expiry, so
    // afterwards the OAuth client carries the current token and its expiry.
    const session = await GoogleAuthProvider.getOrCreateSession(this.vs);
    const expiryDateMs = this.authClient.credentials.expiry_date;
    const expiry = expiryDateMs
      ? new Date(expiryDateMs)
      : new Date(Date.now() + DEFAULT_TOKEN_LIFETIME_MS);
    return { token: session.accessToken, expiry };
  }

  private scheduleNextRefresh(serverId: string, delayMs: number): void {
    const scheduledRefresh = this.refreshByServerId.get(serverId);
    if (!scheduledRefresh || this.isDisposed) {
      return;
    }
    if (scheduledRefresh.nextRefreshTimer) {
      clearTimeout(scheduledRefresh.nextRefreshTimer);
    }
    scheduledRefresh.nextRefreshTimer = setTimeout(() => {
      void this.refreshServer(serverId);
    }, delayMs);
    // Do not keep the extension host process alive solely for this timer.
    scheduledRefresh.nextRefreshTimer.unref();
    log.trace(
      `Scheduled access token refresh for "${serverId}" in ${delayMs.toString()}ms`,
    );
  }

  private async refreshServer(serverId: string): Promise<void> {
    const scheduledRefresh = this.refreshByServerId.get(serverId);
    if (!scheduledRefresh || this.isDisposed) {
      return;
    }
    try {
      const accessToken = await this.fetchAccessToken();
      writeTokenToConnection(scheduledRefresh.connection, accessToken);
      this.scheduleNextRefresh(serverId, delayUntilRefresh(accessToken.expiry));
    } catch (err: unknown) {
      this.retryRefreshUnlessExpiring(serverId, err);
    }
  }

  private retryRefreshUnlessExpiring(
    serverId: string,
    pastIssue: unknown,
  ): void {
    const scheduledRefresh = this.refreshByServerId.get(serverId);
    if (!scheduledRefresh || this.isDisposed) {
      return;
    }
    const msUntilExpiry =
      scheduledRefresh.connection.tokenExpiry.getTime() - Date.now();
    if (msUntilExpiry <= RETRY_DELAY_MS) {
      log.error(
        `Failed to refresh access token for "${serverId}", not retrying`,
        pastIssue,
      );
      return;
    }
    log.warn(
      `Failed to refresh access token for "${serverId}", retrying in ${RETRY_DELAY_MS.toString()}ms`,
      pastIssue,
    );
    this.scheduleNextRefresh(serverId, RETRY_DELAY_MS);
  }

  private cancelScheduledRefresh(serverId: string): void {
    const scheduledRefresh = this.refreshByServerId.get(serverId);
    if (scheduledRefresh?.nextRefreshTimer) {
      clearTimeout(scheduledRefresh.nextRefreshTimer);
    }
    this.refreshByServerId.delete(serverId);
  }

  private guardNotDisposed(): void {
    if (this.isDisposed) {
      throw new Error(
        'Cannot use ConnectionRefresher after it has been disposed',
      );
    }
  }

  /**
   * Stops all refreshing activity.
   */
  dispose(): void {
    this.isDisposed = true;
    for (const { nextRefreshTimer } of this.refreshByServerId.values()) {
      if (nextRefreshTimer) {
        clearTimeout(nextRefreshTimer);
      }
    }
    this.refreshByServerId.clear();
  }
}

function writeTokenToConnection(
  connection: RefreshableConnection,
  accessToken: AccessToken,
): void {
  connection.token = accessToken.token;
  connection.tokenExpiry = accessToken.expiry;
  connection.headers[AUTHORIZATION_HEADER.key] = `Bearer ${accessToken.token}`;
}

function delayUntilRefresh(expiry: Date): number {
  return Math.max(
    expiry.getTime() - Date.now() - REFRESH_BEFORE_EXPIRY_MS,
    MIN_REFRESH_DELAY_MS,
  );
}
