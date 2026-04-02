/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from 'google-auth-library';
import vscode from 'vscode';
import { GoogleAuthProvider } from './auth/auth-provider';
import { getOAuth2Flow } from './auth/flows/flows';
import { login } from './auth/login';
import { AuthStorage } from './auth/storage';
import { CONFIG } from './config';
import { getJupyterApi } from './jupyter/jupyter-extension';
import { WorkbenchJupyterServerProvider } from './jupyter/provider';
import { WorkbenchInstanceManager } from './jupyter/workbench-instance-manager';
import { NotebooksClient } from './workbench/notebooks-client';
import { ProjectsClient } from './workbench/projects-client';

/**
 * Called when the extension is activated.
 *
 * @param context - The extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
  const jupyter = await getJupyterApi(vscode);
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlow = getOAuth2Flow(vscode, authClient);
  const authProvider = new GoogleAuthProvider(
    vscode,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[]) => login(vscode, authFlow, authClient, scopes),
  );
  const notebooksClient = new NotebooksClient(authClient);
  const projectsClient = new ProjectsClient(authClient);

  const workbenchServerProvider = new WorkbenchJupyterServerProvider(
    vscode,
    authProvider.onDidChangeSessions,
    projectsClient,
    new WorkbenchInstanceManager(vscode, notebooksClient, () =>
      GoogleAuthProvider.getOrCreateSession(vscode).then(
        (session) => session.accessToken,
      ),
    ),
    jupyter,
  );

  await authProvider.initialize();
  context.subscriptions.push(authFlow, authProvider, workbenchServerProvider);
}
