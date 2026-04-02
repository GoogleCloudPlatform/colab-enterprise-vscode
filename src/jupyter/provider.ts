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
import { GoogleAuthProvider, AuthChangeEvent } from '../auth/auth-provider';
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
  private isAuthorized = false;
  private readonly authListener: vscode.Disposable;

  constructor(
    private readonly vs: typeof vscode,
    authEvent: vscode.Event<AuthChangeEvent>,
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

    this.authListener = authEvent(this.handleAuthChange.bind(this));
  }

  dispose() {
    this.authListener.dispose();
    this.serverCollection.dispose();
  }

  /**
   * Provides the list of Workbench {@link JupyterServer | Jupyter Servers}.
   */
  async provideJupyterServers(
    _token: CancellationToken,
  ): Promise<JupyterServer[]> {
    if (!this.isAuthorized) {
      return [];
    }
    return await this.instanceManager.getWorkbenchServers();
  }

  /**
   * Resolves the connection for the provided Workbench {@link JupyterServer}.
   */
  async resolveJupyterServer(
    workbenchServer: WorkbenchJupyterServer,
    _token: CancellationToken,
  ): Promise<WorkbenchJupyterServer> {
    if (!this.isAuthorized) {
      const message = 'Unauthorized: unable to resolve Jupyter server';
      // Logging the error because Jupyter extension swallows it
      console.error(message);

      throw new Error(message);
    }
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
    try {
      if (command.label === WORKBENCH_COMMAND.label) {
        // Opens login popup if no active session.
        await GoogleAuthProvider.getOrCreateSession(this.vs);
        return await selectProjectCommand(
          this.vs,
          this.projectsClient,
          this.instanceManager,
        );
      }

      throw new Error(`Unknown command: ${JSON.stringify(command)}`);
    } catch (err: unknown) {
      await this.vs.commands.executeCommand('workbench.action.closeQuickOpen');
      console.error(err);
      throw err;
    }
  }

  private handleAuthChange(e: AuthChangeEvent): void {
    if (this.isAuthorized === e.hasValidSession) {
      return;
    }
    this.isAuthorized = e.hasValidSession;
    this.instanceManager.setProjectId(undefined);
    this.serverChangeEmitter.fire();
  }
}
