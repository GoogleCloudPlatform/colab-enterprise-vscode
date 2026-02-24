/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Jupyter,
  JupyterServer,
  JupyterServerCollection,
  JupyterServerProvider,
  JupyterServerCommandProvider,
  JupyterServerCommand,
} from '@vscode/jupyter-extension';
import type { CancellationToken } from 'vscode';
import vscode from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { selectProjectCommand } from '../workbench/commands';
import { WORKBENCH_COMMAND } from '../workbench/constants';
import { ProjectsClient } from '../workbench/projects-client';
import {
  WorkbenchInstanceManager,
  WorkbenchJupyterServer,
} from './workbench-instance-manager';

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
    vscode.Disposable
{
  readonly onDidChangeServers: vscode.Event<void>;

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
      'google-cloud',
      'Google Cloud',
      this,
    );
    this.serverCollection.commandProvider = this;
  }

  dispose() {
    this.serverCollection.dispose();
  }

  /**
   * Provides the list of Workbench {@link JupyterServer | Jupyter Servers}.
   */
  async provideJupyterServers(
    _token: CancellationToken,
  ): Promise<JupyterServer[]> {
    return await this.instanceManager.getWorkbenchServers();
  }

  /**
   * Resolves the connection for the provided Workbench {@link JupyterServer}.
   */
  async resolveJupyterServer(
    workbenchServer: WorkbenchJupyterServer,
    _token: CancellationToken,
  ): Promise<WorkbenchJupyterServer> {
    return await this.instanceManager.refreshConnection(workbenchServer);
  }

  /**
   * Returns a list of commands which are displayed in a section below
   * resolved servers.
   *
   * This gets invoked every time the value (what the user has typed into the
   * quick pick) changes. But we just return a static list which will be
   * filtered down by the quick pick automatically.
   *
   * It also sets a flag to refresh the server list on the next call to
   * `getWorkbenchServers`. This is needed to ensure that the server list is
   * refreshed when the user interacts with the command palette. That is also
   * why the method needs to stay synchronous.
   */
  provideCommands(
    _value: string | undefined,
    _token: CancellationToken,
  ): JupyterServerCommand[] {
    this.instanceManager.setShouldRefresh();
    return [WORKBENCH_COMMAND];
  }

  /**
   * Resolves the selected command.
   */
  async handleCommand(
    command: JupyterServerCommand,
    _token: CancellationToken,
  ): Promise<JupyterServer | undefined> {
    if (command.label === WORKBENCH_COMMAND.label) {
      // this is needed to open login popup if user doesn't have active session
      // i.e. first login
      await GoogleAuthProvider.getOrCreateSession(this.vs);
      return selectProjectCommand(
        this.vs,
        this.projectsClient,
        this.instanceManager,
      );
    }

    console.error('Unknown command:', command);
    throw new Error(`Unknown command: ${JSON.stringify(command)}`);
  }
}
