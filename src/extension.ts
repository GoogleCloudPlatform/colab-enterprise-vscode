/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Jupyter } from '@vscode/jupyter-extension';
import { OAuth2Client } from 'google-auth-library';
import vscode, { Disposable } from 'vscode';
import { GoogleAuthProvider } from './auth/auth-provider';
import { getOAuth2Flows } from './auth/flows/flows';
import { login } from './auth/login';
import { AuthStorage } from './auth/storage';
import { initializeLogger, log } from './common/logging';
import { CONFIG } from './config';
import { getPackageInfo } from './config/package-info';
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
  const logging = initializeLogger(vscode, context.extensionMode);
  const jupyter = await getJupyterApi(vscode);
  logEnvInfo(jupyter);

  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlows = getOAuth2Flows(vscode, authClient);
  const authProvider = new GoogleAuthProvider(
    vscode,
    new AuthStorage(context.secrets),
    authClient,
    (scopes: string[]) => login(vscode, authFlows, authClient, scopes),
  );
  await authProvider.initialize();

  const notebooksClient = new NotebooksClient(authClient);
  const projectsClient = new ProjectsClient(authClient);

  const workbenchServerProvider = new WorkbenchJupyterServerProvider(
    vscode,
    projectsClient,
    new WorkbenchInstanceManager(vscode, notebooksClient, () =>
      GoogleAuthProvider.getOrCreateSession(vscode).then(
        (session) => session.accessToken,
      ),
    ),
    jupyter.exports,
  );

  context.subscriptions.push(
    logging,
    disposeAll(authFlows),
    authProvider,
    workbenchServerProvider,
  );
}

function logEnvInfo(jupyter: vscode.Extension<Jupyter>) {
  log.info(`${vscode.env.appName}: ${vscode.version}`);
  log.info(`Remote: ${vscode.env.remoteName ?? 'N/A'}`);
  log.info(`App Host: ${vscode.env.appHost}`);
  const jupyterVersion = getPackageInfo(jupyter).version;
  log.info(`Jupyter extension version: ${jupyterVersion}`);
}

/**
 * Returns a Disposable that calls dispose on all items in the array which are
 * disposable.
 */
function disposeAll(items: { dispose?: () => void }[]): Disposable {
  return {
    dispose: () => {
      items.forEach((item) => item.dispose?.());
    },
  };
}
