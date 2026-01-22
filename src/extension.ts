/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from "google-auth-library";
import vscode, { Disposable } from "vscode";
import { GoogleAuthProvider } from "./auth/auth-provider";
import { getOAuth2Flows } from "./auth/flows/flows";
import { login } from "./auth/login";
import { AuthStorage } from "./auth/storage";
import { ColabClient } from "./colab/client";
import { ConsumptionNotifier } from "./colab/consumption/notifier";
import { ConsumptionPoller } from "./colab/consumption/poller";
import { ServerKeepAliveController } from "./colab/keep-alive";
import { CONFIG } from "./colab-config";
import { Toggleable } from "./common/toggleable";
import { AssignmentManager } from "./jupyter/assignments";
import { getJupyterApi } from "./jupyter/jupyter-extension";
import { WorkbenchJupyterServerProvider } from "./jupyter/provider";
import { ServerStorage } from "./jupyter/storage";
import { WorkbenchInstanceManager } from "./jupyter/workbench-instance-manager";
import { ExtensionUriHandler } from "./system/uri-handler";
import { NotebooksClient } from "./workbench/notebooks-client";
import { ProjectsClient } from "./workbench/projects-client";

/**
 * Called when the extension is activated.
 *
 * @param context - The extension context.
 */
export async function activate(context: vscode.ExtensionContext) {
  const jupyter = await getJupyterApi(vscode);
  const uriHandler = new ExtensionUriHandler(vscode);
  const uriHandlerRegistration = vscode.window.registerUriHandler(uriHandler);
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
  const colabClient = new ColabClient(
    new URL(CONFIG.ColabApiDomain),
    new URL(CONFIG.ColabGapiDomain),
    () =>
      GoogleAuthProvider.getOrCreateSession(vscode).then(
        (session) => session.accessToken,
      ),
  );
  const serverStorage = new ServerStorage(vscode, context.secrets);
  const assignmentManager = new AssignmentManager(
    vscode,
    colabClient,
    serverStorage,
  );

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
    jupyter,
  );

  const keepServersAlive = new ServerKeepAliveController(
    vscode,
    colabClient,
    assignmentManager,
  );
  const consumptionMonitor = watchConsumption(colabClient);
  // Sending server "keep-alive" pings and monitoring consumption requires
  // issuing authenticated requests to Colab. This can only be done after the
  // user has signed in. We don't block extension activation on completing the
  // heavily asynchronous sign-in flow.
  const whileAuthorizedToggle = authProvider.whileAuthorized(
    keepServersAlive,
    consumptionMonitor.toggle,
  );

  context.subscriptions.push(
    uriHandler,
    uriHandlerRegistration,
    disposeAll(authFlows),
    authProvider,
    assignmentManager,
    workbenchServerProvider,
    keepServersAlive,
    ...consumptionMonitor.disposables,
    whileAuthorizedToggle,
  );
}

/**
 * Sets up consumption monitoring.
 *
 * If the user has already signed in, starts immediately. Otherwise, waits until
 * the user signs in.
 */
function watchConsumption(colab: ColabClient): {
  toggle: Toggleable;
  disposables: Disposable[];
} {
  const disposables: Disposable[] = [];
  const poller = new ConsumptionPoller(vscode, colab);
  disposables.push(poller);
  const notifier = new ConsumptionNotifier(
    vscode,
    colab,
    poller.onDidChangeCcuInfo,
  );
  disposables.push(notifier);

  return { toggle: poller, disposables };
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
