/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Credentials as OAuth2Credentials,
  OAuth2Client,
} from 'google-auth-library';
import { v4 as uuid } from 'uuid';
import vscode from 'vscode';
import { OAuth2TriggerOptions, FlowResult, OAuth2Flow } from './flows/flows';

/**
 * A complete set of credentials produced from completing OAuth2 authentication.
 */
export type Credentials = OAuth2Credentials & {
  [P in keyof RequiredCredentials]-?: NonNullable<RequiredCredentials[P]>;
};

/**
 * Manages the login process for Google OAuth2 authentication.
 *
 * Since logging in involves users leaving the editor to complete a
 * browser-based sign-in, there's some natural flake! Both at the user and code
 * level. A user could accidentally close a tab, the browser could crash, etc.
 * Beyond that, the user could have a bizarre network configuration, preventing
 * the extension from launching the loopback server. Due to all this "flake", we
 * attempt several flows depending on the environment capabilities (e.g. it's
 * not possible to launch a loopback server in a remote extension host).
 */
export async function login(
  vs: typeof vscode,
  flow: OAuth2Flow,
  client: OAuth2Client,
  scopes: string[],
): Promise<Credentials> {
  return await vs.window.withProgress<Credentials>(
    {
      location: vs.ProgressLocation.Notification,
      title: 'Signing in to Google...',
      cancellable: true,
    },
    async (_, cancel: vscode.CancellationToken) => {
      const nonce = uuid();
      const pkce = await client.generateCodeVerifierAsync();
      const triggerOptions: OAuth2TriggerOptions = {
        cancel,
        nonce,
        scopes,
        pkceChallenge: pkce.codeChallenge,
      };
      const flowResult = await flow.trigger(triggerOptions);
      const res = await exchangeCodeForCredentials(
        client,
        flowResult,
        pkce.codeVerifier,
      );

      return res;
    },
  );
}

/**
 * Creates a callback handler for 'UNABLE_TO_GET_ISSUER_CERT' errors
 * during login.
 *
 * If the error is 'UNABLE_TO_GET_ISSUER_CERT', it prompts the user to enable
 * "http.systemCertificatesNode". This allows VS Code to use the system's
 * trusted SSL certificates.
 *
 * See https://github.com/microsoft/vscode/issues/277300 for context.
 *
 * @param vs - The VS Code API.
 * @returns A callback function that handles the error.
 */
export function createCertificateErrorHandler(
  vs: typeof vscode,
): (err: unknown) => Promise<void> {
  return async (err: unknown) => {
    if (isCertificateError(err)) {
      await checkAndPromptSystemCertificates(vs);
    }
  };
}

async function exchangeCodeForCredentials(
  oAuth2Client: OAuth2Client,
  flowResult: FlowResult,
  pkceVerifier: string,
) {
  const tokenResponse = await oAuth2Client.getToken({
    code: flowResult.code,
    codeVerifier: pkceVerifier,
    redirect_uri: flowResult.redirectUri,
  });
  if (tokenResponse.res?.status !== 200) {
    const details = tokenResponse.res
      ? tokenResponse.res.statusText
      : 'unknown error';
    throw new Error(`Failed to get token: ${details}.`);
  }
  if (!isDefinedCredentials(tokenResponse.tokens)) {
    throw new Error('Missing credential information.');
  }
  return tokenResponse.tokens;
}

type RequiredCredentials = Pick<
  OAuth2Credentials,
  'refresh_token' | 'access_token' | 'expiry_date' | 'scope'
>;

function isDefinedCredentials(
  credentials: OAuth2Credentials,
): credentials is Credentials {
  return (
    credentials.refresh_token != null &&
    credentials.access_token != null &&
    credentials.expiry_date != null &&
    credentials.scope != null
  );
}

const UNABLE_TO_GET_ISSUER_CERT = 'UNABLE_TO_GET_ISSUER_CERT';

function isCertificateError(err: unknown): boolean {
  if (err && typeof err === 'object' && 'code' in err) {
    return err.code === UNABLE_TO_GET_ISSUER_CERT;
  }
  return false;
}

async function checkAndPromptSystemCertificates(vs: typeof vscode) {
  const config = vs.workspace.getConfiguration('http');
  const systemCertificatesNode = config.get<boolean>('systemCertificatesNode');

  if (systemCertificatesNode === true) {
    return;
  }

  const message =
    'Unable to get issuer certificate. Please enable "http.systemCertificatesNode" in VS Code settings. This allows VS Code to use the system\'s trusted SSL certificates.';
  const enableAction = 'Enable';

  const result = await vs.window.showInformationMessage(message, enableAction);

  if (result === enableAction) {
    await config.update(
      'systemCertificatesNode',
      true,
      vs.ConfigurationTarget.Global,
    );
    const reloadAction = 'Reload Window';
    const selection = await vs.window.showInformationMessage(
      'Successfully enabled "http.systemCertificatesNode". Please reload the window for the change to take effect.',
      reloadAction,
    );
    if (selection === reloadAction) {
      vs.commands.executeCommand('workbench.action.reloadWindow');
    }
  }
}
