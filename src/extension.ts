/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OAuth2Client } from "google-auth-library";
import vscode, { Disposable } from "vscode";
import { GoogleAuthProvider } from "./auth/auth-provider";
import { getOAuth2Flows } from "./auth/flows/flows";
import { login } from "./auth/login";
import { AuthStorage } from "./auth/storage";
import { ColabClient } from "./colab/client";
import {
} from "./colab/commands/constants";
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
  const authClient = new OAuth2Client(
    CONFIG.ClientId,
    CONFIG.ClientNotSoSecret,
  );
  const authFlows = getOAuth2Flows(
    vscode,
    authClient,
  );
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


  context.subscriptions.push(
    disposeAll(authFlows),
    authProvider,
    assignmentManager,
    workbenchServerProvider,
  );
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
