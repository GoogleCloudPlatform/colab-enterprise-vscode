/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import { CodeChallengeMethod, GenerateAuthUrlOpts } from 'google-auth-library';
import { OAuth2Client } from 'google-auth-library';
import vscode from 'vscode';
import { LocalServerFlow } from './loopback';

/**
 * Options for triggering an OAuth2 flow.
 */
export interface OAuth2TriggerOptions {
  /** Fired when the flow should be cancelled. */
  readonly cancel: vscode.CancellationToken;
  /** A unique nonce to correlate the request and response. */
  readonly nonce: string;
  /** The scopes the flow should authorize for. */
  readonly scopes: string[];
  /** The PKCE challenge string which if specific should be included with the auth request. */
  readonly pkceChallenge?: string;
}

export interface FlowResult {
  /** The authorization code obtained from the OAuth2 flow. */
  code: string;
  /** The redirect URI that should be used following token retrieval. */
  redirectUri?: string;
}

/**
 * An OAuth2 flow that can be triggered to obtain an authorization code.
 */
export interface OAuth2Flow extends vscode.Disposable {
  /** Triggers the OAuth2 flow. */
  trigger(options: OAuth2TriggerOptions): Promise<FlowResult>;
}

export const DEFAULT_AUTH_URL_OPTS: GenerateAuthUrlOpts = {
  access_type: 'offline',
  response_type: 'code',
  prompt: 'consent',
  code_challenge_method: CodeChallengeMethod.S256,
};

/**
 * Returns the supported OAuth2 flow.
 */
export function getOAuth2Flow(
  vs: typeof vscode,
  oAuth2Client: OAuth2Client,
): OAuth2Flow {
  return new LocalServerFlow(
    vs,
    path.join(__dirname, 'auth/media'),
    oAuth2Client,
  );
}
