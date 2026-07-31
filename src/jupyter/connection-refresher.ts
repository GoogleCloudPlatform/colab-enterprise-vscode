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
    // Register the connection before fetching so the shared core (which
    // schedules by looking the server up in the map) can find it. Registering
    // first also replaces any prior schedule for this server, making repeat
    // calls idempotent. Unlike the scheduled path, failures here are allowed to
    // propagate: the caller (initial connect) must learn the first token fetch
    // failed rather than proceed with an unauthenticated connection.
    this.cancelScheduledRefresh(serverId);
    this.refreshByServerId.set(serverId, { connection });
    try {
      await this.refreshAndReschedule(serverId, connection);
    } catch (err: unknown) {
      // The scheduled path logs its own failures (retryRefreshUnlessExpiring),
      // but the initial attempt has no such handler, so log here before it
      // propagates to keep failures visible in the output channel.
      log.error(`Failed to refresh access token for "${serverId}"`, err);
      throw err;
    }
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
      void this.runScheduledRefresh(serverId);
    }, delayMs);
    // Do not keep the extension host process alive solely for this timer.
    scheduledRefresh.nextRefreshTimer.unref();
    // Info level (not trace) so the schedule is visible in the "Workbench
    // Notebooks" output channel; this fires about once per token lifetime.
    log.info(
      `Scheduled next access token refresh for "${serverId}" in ${delayMs.toString()}ms`,
    );
  }

  /**
   * Runs a refresh that was triggered by a scheduled timer.
   *
   * This is the self-healing counterpart to {@link refresh}: the server is
   * already being watched, so it is looked up rather than registered, and a
   * failure must not escape the timer (there is no caller to catch it) so it is
   * swallowed and retried instead. It shares its token-stamping core with the
   * initial refresh via {@link refreshAndReschedule}.
   */
  private async runScheduledRefresh(serverId: string): Promise<void> {
    const scheduledRefresh = this.refreshByServerId.get(serverId);
    if (!scheduledRefresh || this.isDisposed) {
      return;
    }
    try {
      await this.refreshAndReschedule(serverId, scheduledRefresh.connection);
    } catch (err: unknown) {
      this.retryRefreshUnlessExpiring(serverId, err);
    }
  }

  /**
   * The core shared by the initial {@link refresh} and each
   * {@link runScheduledRefresh}: fetch a fresh token, stamp it into the
   * connection in place, and schedule the next refresh ahead of the new token's
   * expiry.
   *
   * Factored out because both paths do exactly this; they differ only in how
   * they obtain the connection (registered vs. looked up) and how they treat
   * failures (propagated vs. retried), which stays in the two callers.
   *
   * The server must already be registered in {@link refreshByServerId} before
   * this is called, since {@link scheduleNextRefresh} keys off that entry.
   */
  private async refreshAndReschedule(
    serverId: string,
    connection: RefreshableConnection,
  ): Promise<void> {
    const accessToken = await this.fetchAccessToken();
    writeTokenToConnection(connection, accessToken);
    // Record that a refresh actually happened so token rotation is observable
    // over a long-lived session, not just when something goes wrong.
    log.info(
      `Refreshed access token for "${serverId}"; expires at ${accessToken.expiry.toISOString()}`,
    );
    this.scheduleNextRefresh(serverId, delayUntilRefresh(accessToken.expiry));
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
