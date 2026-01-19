/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";

import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerProvider,
  JupyterServerCommandProvider,
  JupyterServerCommand,
} from "@vscode/jupyter-extension";
import type { CancellationToken, ProviderResult } from "vscode";
import vscode from "vscode"
import { WORKBENCH_COMMAND } from "../colab/commands/constants";
import { selectProjectCommand } from "../workbench/commands";
import { ProjectsClient } from "../workbench/projects-client";
import {
  WorkbenchInstanceManager,
  WorkbenchJupyterServer
} from "./workbench-instance-manager";

import State = protos.google.cloud.notebooks.v2.State;

/**
 * Workbench Jupyter server provider.
 *
 * Provides a dynamic list of Workbench Jupyter servers from Google Cloud
 * Projects.
 */
export class WorkbenchJupyterServerProvider
  implements
  JupyterServerProvider,
  JupyterServerCommandProvider,
  vscode.Disposable {
  readonly onDidChangeServers:
    vscode.Event<void>;

  private readonly serverCollection: JupyterServerCollection;
  private readonly serverChangeEmitter: vscode.EventEmitter<void>;

  constructor(
    private readonly vs: typeof vscode,
    private readonly projectsClient: ProjectsClient,
    private readonly instanceManager: WorkbenchInstanceManager,
    jupyter: Jupyter,
  ) {
    this.serverChangeEmitter = new this.vs.EventEmitter<void>();
    this.onDidChangeServers = this.serverChangeEmitter.event;

    this.serverCollection = jupyter.createJupyterServerCollection(
      "google-cloud-workbench",
      "Google Cloud Workbench",
      this,
    );
    this.serverCollection.commandProvider = this;

    this.instanceManager.onDidChangeServers(() => {
      this.serverChangeEmitter.fire();
    });
  }

  dispose() {
    this.serverCollection.dispose();
    this.serverChangeEmitter.dispose();
  }

  /**
   * Provides the list of Workbench {@link JupyterServer | Jupyter Servers}.
   */
  provideJupyterServers(
    _token: CancellationToken,
  ): JupyterServer[] {
    return this.instanceManager.getWorkbenchServers('active');
  }

  /**
   * Resolves the connection for the provided Workbench {@link JupyterServer}.
   */
  async resolveJupyterServer(
    workbenchServer: WorkbenchJupyterServer,
    _token: CancellationToken,
  ): Promise<WorkbenchJupyterServer> {
    const resolvedServer = await this.instanceManager.refreshConnection(
      workbenchServer.id,
      workbenchServer.projectId
    );

    if (resolvedServer.state !== State.ACTIVE) {
      const message =
        `Server ${String(resolvedServer.name)} is not active (State: ${String(resolvedServer.state)}). 
        Please start it from the Google Cloud Console.`;
      const consoleUrl =
        `https://console.cloud.google.com/vertex-ai/workbench/instances?project=${workbenchServer.projectId}`;

      void this.vs.window
        .showErrorMessage(message, "Open Console")
        .then(selection => {
          if (selection === "Open Console") {
            void this.vs.env.openExternal(this.vs.Uri.parse(consoleUrl));
          }
        });

      throw new Error(message);
    }

    return resolvedServer;
  }


  /**
 * Returns a list of commands which are displayed in a section below
 * resolved servers.
 *
 * This gets invoked every time the value (what the user has typed into the
 * quick pick) changes. But we just return a static list which will be
 * filtered down by the quick pick automatically.
 */
  provideCommands(
    _value: string | undefined,
    _token: CancellationToken,
  ): JupyterServerCommand[] {
    this.vs.window.withProgress(
      {
        location: this.vs.ProgressLocation.Notification,
        title: "Fetching Workbench servers...",
      },
      async () => {
        try {
          await this.instanceManager.loadWorkbenchServers();
          this.serverChangeEmitter.fire();
        } catch (error) {
          console.error("Failed to load workbench servers:", error);
        }
      },
    );

    return [WORKBENCH_COMMAND];
  }

  /**
   * Resolves the selected command.
   */
  handleCommand(
    command: JupyterServerCommand,
    _token: CancellationToken,
  ): ProviderResult<JupyterServer> {
    if (command.label === WORKBENCH_COMMAND.label) {
      return selectProjectCommand(
        this.vs,
        this.projectsClient,
        this.instanceManager,
      );
    }

    console.error("Unknown command:", command);
    throw new Error(`Unknown command: ${JSON.stringify(command)}`);
  }
}
