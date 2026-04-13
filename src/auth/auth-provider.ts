/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import fetch from 'node-fetch';
import { v4 as uuid } from 'uuid';
import vscode, { AuthenticationSession, Disposable } from 'vscode';
import { z } from 'zod';
import { log } from '../common/logging/logger';
import { Toggleable } from '../common/toggleable';
import { AUTHORIZATION_HEADER } from '../workbench/headers';
import { Credentials } from './login';
import { AuthStorage, RefreshableAuthenticationSession } from './storage';

export const REQUIRED_SCOPES = [
  'profile',
  'email',
  'https://www.googleapis.com/auth/cloud-platform',
] as const;
const PROVIDER_ID = 'google-cloud-platform';
const PROVIDER_LABEL = 'Google Cloud Platform';
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
const UNABLE_TO_GET_ISSUER_CERT = 'UNABLE_TO_GET_ISSUER_CERT';
const SYSTEM_CERTIFICATES_NODE = 'systemCertificatesNode';

/**
 * An {@link vscode.Event} which fires when an authentication session is added,
 * removed, or changed.
 */
export interface AuthChangeEvent
  extends vscode.AuthenticationProviderAuthenticationSessionsChangeEvent {
  /**
   * True when there is a valid {@link vscode.AuthenticationSession} for the
   * {@link vscode.AuthenticationProvider}.
   */
  hasValidSession: boolean;
}

/**
 * Provides authentication using Google OAuth2.
 *
 * Registers itself with the VS Code authentication API and emits events when
 * authentication sessions change.
 *
 * Session access tokens are refreshed JIT upon access if they are near or past
 * their expiry.
 */
export class GoogleAuthProvider
  implements vscode.AuthenticationProvider, vscode.Disposable
{
  readonly onDidChangeSessions: vscode.Event<AuthChangeEvent>;
  private isInitialized = false;
  private readonly authProvider: vscode.Disposable;
  private readonly emitter: vscode.EventEmitter<AuthChangeEvent>;
  private session?: Readonly<AuthenticationSession>;
  private readonly disposeController = new AbortController();
  private readonly disposeSignal: AbortSignal = this.disposeController.signal;

  /**
   * Initializes the GoogleAuthProvider.
   *
   * @param vs - The VS Code API.
   * @param context - The extension context used for managing lifecycle.
   * @param oAuth2Client - The OAuth2 client for handling Google authentication.
   * @param codeProvider - The provider responsible for generating authorization
   * codes.
   * @param login - A function that initiates the login process with the
   * specified scopes.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly storage: AuthStorage,
    private readonly oAuth2Client: OAuth2Client,
    private readonly login: (scopes: string[]) => Promise<Credentials>,
  ) {
    this.emitter = new vs.EventEmitter<AuthChangeEvent>();
    this.onDidChangeSessions = this.emitter.event;

    this.authProvider = this.vs.authentication.registerAuthenticationProvider(
      PROVIDER_ID,
      PROVIDER_LABEL,
      this,
      { supportsMultipleAccounts: false },
    );
  }

  /**
   * Retrieves the Google OAuth2 authentication session.
   *
   * @param vs - The VS Code API.
   * @returns The authentication session.
   */
  static async getOrCreateSession(
    vs: typeof vscode,
  ): Promise<vscode.AuthenticationSession> {
    const session = await vs.authentication.getSession(
      PROVIDER_ID,
      REQUIRED_SCOPES,
      {
        createIfNone: true,
      },
    );
    return session;
  }

  /**
   * Disposes the provider and cleans up resources.
   */
  dispose() {
    this.authProvider.dispose();
    this.disposeController.abort(new Error('GoogleAuthProvider was disposed.'));
  }

  /**
   * Initializes the provider by loading the session from storage, saturating
   * and refreshing the OAuth2 client.
   */
  async initialize() {
    if (this.disposeSignal.aborted) {
      throw this.disposeSignal.reason;
    }
    if (this.isInitialized) {
      return;
    }
    const session = await this.storage.getSession();
    if (!session) {
      this.isInitialized = true;
      return;
    }
    this.oAuth2Client.setCredentials({
      refresh_token: session.refreshToken,
      token_type: 'Bearer',
      scope: session.scopes.join(' '),
    });
    try {
      await this.oAuth2Client.refreshAccessToken();
    } catch (err: unknown) {
      log.warn(`Failed to refresh token during initialization: ${String(err)}`);
      // The refresh token is likely invalid or revoked.
      // Clear the session so the user can sign in again.
      await this.storage.removeSession(session.id);
      this.isInitialized = true;
      return;
    }
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error('Failed to refresh Google OAuth token.');
    }
    this.session = {
      id: session.id,
      accessToken,
      account: session.account,
      scopes: session.scopes,
    };
    this.isInitialized = true;
    this.emitter.fire({
      added: [],
      removed: [],
      changed: [this.session],
      hasValidSession: true,
    });
  }

  /**
   * Sets the state of the toggles based on the authentication session.
   *
   * @returns A {@link Disposable} that can be used to stop toggling the
   * provided toggles when there are changes to the authorization status.
   */
  whileAuthorized(...toggles: Toggleable[]): Disposable {
    this.assertReady();
    const setToggles = () => {
      if (this.session === undefined) {
        toggles.forEach((t) => {
          t.off();
        });
      } else {
        toggles.forEach((t) => {
          t.on();
        });
      }
    };
    const listener = this.onDidChangeSessions(setToggles);
    // Call the function initially to set the correct state.
    setToggles();
    return listener;
  }

  /**
   * Get the list of managed sessions.
   *
   * The session's access token is refreshed if it is near or past its expiry.
   *
   * @param scopes - An optional array of scopes. If provided, the sessions
   * returned will match these permissions. Otherwise, all sessions are
   * returned.
   * @param options - Additional options for getting sessions. If an account is
   * passed in, sessions returned are limited to it.
   * @returns An array of managed authentication sessions.
   */
  async getSessions(
    scopes: readonly string[] | undefined,
    options: vscode.AuthenticationProviderSessionOptions,
  ): Promise<vscode.AuthenticationSession[]> {
    this.assertReady();
    if (scopes && !matchesRequiredScopes(scopes)) {
      return [];
    }
    await this.refreshSessionIfNeeded();
    if (options.account && this.session?.account != options.account) {
      return [];
    }
    return this.session ? [this.session] : [];
  }

  /**
   * Creates and stores an authentication session with the given scopes.
   *
   * @param scopes - Scopes required for the session. These must strictly be the
   * collection of {@link REQUIRED_SCOPES}.
   * @returns The created session.
   * @throws An error if login fails.
   */
  async createSession(scopes: string[]): Promise<vscode.AuthenticationSession> {
    this.assertReady();
    try {
      const sortedScopes = scopes.sort();
      if (!matchesRequiredScopes(sortedScopes)) {
        throw new Error(
          `Only supports the following scopes: ${sortedScopes.join(', ')}`,
        );
      }
      const tokenInfo = await this.login(sortedScopes);
      const user = await this.getUserInfo(tokenInfo.access_token);
      const existingSession = await this.storage.getSession();
      const newSession: RefreshableAuthenticationSession = {
        id: existingSession ? existingSession.id : uuid(),
        refreshToken: tokenInfo.refresh_token,
        account: {
          id: user.email,
          label: user.name,
        },
        scopes: sortedScopes,
      };
      await this.storage.storeSession(newSession);
      this.oAuth2Client.setCredentials(tokenInfo);
      this.session = {
        id: newSession.id,
        accessToken: tokenInfo.access_token,
        account: newSession.account,
        scopes: sortedScopes,
      };

      if (existingSession) {
        this.emitter.fire({
          added: [],
          removed: [],
          changed: [this.session],
          hasValidSession: true,
        });
      } else {
        this.emitter.fire({
          added: [this.session],
          removed: [],
          changed: [],
          hasValidSession: true,
        });
      }
      this.vs.window.showInformationMessage(
        'Signed in to Google Cloud Platform!',
      );
      return this.session;
    } catch (err: unknown) {
      await this.handleCertificateError(err);
      const msg = err instanceof Error ? err.message : 'unknown error';
      this.vs.window.showErrorMessage(`Sign in failed: ${msg}`);
      throw err;
    }
  }

  /**
   * Removes a session by ID.
   *
   * This will revoke the credentials (if the matching session is managed) and
   * remove the session from storage.
   *
   * @param sessionId - The session ID.
   */
  async removeSession(sessionId: string): Promise<void> {
    this.assertReady();
    if (this.session?.id !== sessionId) {
      return;
    }
    const removedSession = this.session;
    this.session = undefined;
    try {
      await this.oAuth2Client.revokeCredentials();
    } catch {
      // It's possible the token is already expired or revoked. We can swallow
      // errors since the user will be required to login again.
    }
    await this.storage.removeSession(sessionId);

    this.vs.window.showInformationMessage(
      'Signed out of Google Cloud Platform!',
    );

    this.emitter.fire({
      added: [],
      removed: [removedSession],
      changed: [],
      hasValidSession: false,
    });
  }

  private async refreshSessionIfNeeded(): Promise<void> {
    if (!this.session) {
      return;
    }
    const expiryDateMs = this.oAuth2Client.credentials.expiry_date;
    if (expiryDateMs && expiryDateMs > Date.now() + REFRESH_MARGIN_MS) {
      return;
    }
    await this.oAuth2Client.refreshAccessToken();
    const accessToken = this.oAuth2Client.credentials.access_token;
    if (!accessToken) {
      throw new Error('Failed to refresh Google OAuth token.');
    }
    this.session = {
      ...this.session,
      accessToken,
    };
  }

  private async getUserInfo(
    token: string,
  ): Promise<z.infer<typeof UserInfoSchema>> {
    const url = 'https://www.googleapis.com/oauth2/v2/userinfo';
    const response = await fetch(url, {
      headers: {
        [AUTHORIZATION_HEADER.key]: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch user info: ${response.statusText}. Response: ${errorText}`,
      );
    }
    const json: unknown = await response.json();
    return UserInfoSchema.parse(json);
  }

  private isCertificateError(err: unknown): boolean {
    if (err && typeof err === 'object' && 'code' in err) {
      return err.code === UNABLE_TO_GET_ISSUER_CERT;
    }
    return false;
  }

  private shouldPromptSystemCertificates(): boolean {
    const config = this.vs.workspace.getConfiguration('http');
    return config.get<boolean>(SYSTEM_CERTIFICATES_NODE) !== true;
  }

  private async promptSystemCertificates(): Promise<void> {
    const config = this.vs.workspace.getConfiguration('http');
    const message = `Unable to get issuer certificate. Please enable "http.${SYSTEM_CERTIFICATES_NODE}" in VS Code settings. This allows VS Code to use the system's trusted SSL certificates.`;
    const enableAction = 'Enable';

    const result = await this.vs.window.showInformationMessage(
      message,
      enableAction,
    );

    if (result === enableAction) {
      await config.update(
        SYSTEM_CERTIFICATES_NODE,
        true,
        this.vs.ConfigurationTarget.Global,
      );
      const reloadAction = 'Reload Window';
      const selection = await this.vs.window.showInformationMessage(
        `Successfully enabled "http.${SYSTEM_CERTIFICATES_NODE}". Please reload the window for the change to take effect.`,
        reloadAction,
      );
      if (selection === reloadAction) {
        this.vs.commands.executeCommand('workbench.action.reloadWindow');
      }
    }
  }

  private async handleCertificateError(err: unknown): Promise<void> {
    if (this.isCertificateError(err) && this.shouldPromptSystemCertificates()) {
      await this.promptSystemCertificates();
    }
  }

  private assertReady(): void {
    if (!this.isInitialized) {
      throw new Error(`Must call initialize() first.`);
    }
    if (this.disposeSignal.aborted) {
      throw this.disposeSignal.reason;
    }
  }
}

function matchesRequiredScopes(scopes: readonly string[]): boolean {
  return (
    scopes.length === REQUIRED_SCOPES.length &&
    REQUIRED_SCOPES.every((r) => scopes.includes(r))
  );
}

/**
 * User information queried for following a successful login.
 */
const UserInfoSchema = z.object({
  name: z.string(),
  email: z.string(),
});
