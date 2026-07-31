/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from '@google-cloud/notebooks';
import { JupyterServer } from '@vscode/jupyter-extension';
import vscode from 'vscode';
import { withError } from '../utils/errors';
import { AUTHORIZATION_HEADER } from '../workbench/headers';
import { NotebooksClient } from '../workbench/notebooks-client';
import { ConnectionRefresher } from './connection-refresher';

import IInstance = protos.google.cloud.notebooks.v2.IInstance;

const UNKNOWN_ID = 'UNKNOWN_ID';
const UNKNOWN_NAME = 'UNKNOWN_NAME';

/**
 * The HTTP headers used to authenticate against a Workbench Jupyter server.
 */
export interface WorkbenchConnectionHeaders {
  [AUTHORIZATION_HEADER.key]: string;
  Cookie: string;
  'X-XSRFToken': string;
  Origin: string;
}

/**
 * The connection information for a Workbench Jupyter server, including its
 * current access token and the time that token expires. The token and its
 * `Authorization` header are kept fresh in place by the
 * {@link ConnectionRefresher}.
 */
export interface WorkbenchServerConnection {
  baseUrl: vscode.Uri;
  token: string;
  tokenExpiry: Date;
  headers: WorkbenchConnectionHeaders;
}

export interface WorkbenchJupyterServer extends JupyterServer {
  name: string;
  projectId: string;
  /** The proxy URI for connecting to the Jupyter server. */
  proxyUri: string;
  connectionInformation?: WorkbenchServerConnection;
}

/**
 * Manages the lifecycle and connection details of Workbench Jupyter server
 * instances.
 *
 * This class is responsible for:
 * - Fetching Workbench instances from the Google Cloud Notebooks API.
 * - Converting raw instance data into `WorkbenchJupyterServer` objects
 *   compatible with the VS Code Jupyter extension.
 * - Managing authentication and connection information (Proxy URIs, Access
 *   Tokens) for these servers.
 * - Refreshing server state and connections on demand.
 */
export class WorkbenchInstanceManager {
  private projectId?: string;
  private shouldRefresh = false;
  private cachedServers: WorkbenchJupyterServer[] = [];

  /**
   * Sets the flag indicating whether the server list should be refreshed
   * from the API on the next call to `getWorkbenchServers`.
   *
   * The flag is needed to prevent sending API calls to the Notebooks API
   * every time the Jupyter extension calls `provideJupyterServers`, which
   * happens even during cell execution. We only want to refresh the server
   * list when the user explicitly requests it by interacting with the
   * command palette.
   */
  setShouldRefresh() {
    this.shouldRefresh = true;
  }

  /**
   * Creates a new instance of WorkbenchInstanceManager.
   *
   * @param vs - The VS Code API instance.
   * @param notebooksClient - The client for interacting with the Notebooks API.
   * @param refresher - Keeps the connection's access token fresh; its current
   * token is embedded into each server's connection headers.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly notebooksClient: NotebooksClient,
    private readonly refresher: ConnectionRefresher,
  ) {}

  /**
   * Sets the current GCP project ID.
   *
   * @param projectId - The ID of the GCP project.
   */
  setProjectId(projectId?: string) {
    this.projectId = projectId;
  }

  /**
   * Builds connection information for a server and starts keeping its access
   * token fresh.
   *
   * A fresh token is stamped into the connection now, and the connection is
   * watched so its token keeps refreshing ahead of expiry for the whole
   * lifetime of the connection, not just at connect time (b/533128081).
   *
   * @param workbenchServer - The server to build connection information for.
   * @returns The server with connection information attached.
   */
  async refreshConnection(
    workbenchServer: WorkbenchJupyterServer,
  ): Promise<WorkbenchJupyterServer> {
    const baseUrlString = `https://${workbenchServer.proxyUri}`;
    const connectionInformation: WorkbenchServerConnection = {
      baseUrl: this.vs.Uri.parse(baseUrlString),
      token: '',
      tokenExpiry: new Date(0),
      headers: {
        [AUTHORIZATION_HEADER.key]: '',
        Cookie: '_xsrf=XSRF',
        'X-XSRFToken': 'XSRF',
        Origin: baseUrlString,
      },
    };
    // Stamps a fresh token into the connection and keeps it refreshed in place.
    await this.refresher.refresh(workbenchServer.id, connectionInformation);
    return { ...workbenchServer, connectionInformation };
  }

  /**
   * Returns the list of active only Workbench Jupyter servers.
   *
   * @returns An array of WorkbenchJupyterServer objects.
   */
  async getWorkbenchServers(): Promise<WorkbenchJupyterServer[]> {
    const { projectId } = this;
    if (!projectId) {
      return [];
    }

    if (!this.shouldRefresh) {
      return this.cachedServers;
    }

    const instances = await this.vs.window.withProgress(
      {
        location: this.vs.ProgressLocation.Notification,
        title: 'Fetching Workbench instances...',
        cancellable: false,
      },
      () =>
        withError(
          /* operation= */ () => this.notebooksClient.listInstances(projectId),
          /* defaultValue= */ [],
          /* errorMessage= */ 'Failed to list Workbench instances',
        ),
    );
    this.cachedServers = instances.map((instance) =>
      this.createWorkbenchJupyterServer(instance, projectId),
    );
    this.shouldRefresh = false;

    if (this.cachedServers.length === 0) {
      this.vs.window.showInformationMessage(
        `No active Workbench instances found in project: ${projectId}.`,
      );
      this.projectId = undefined;
    }

    return this.cachedServers;
  }

  /**
   * Creates a WorkbenchJupyterServer object from a raw Workbench instance.
   *
   * @param instance - The Workbench instance data from the API.
   * @param projectId - The ID of the GCP project containing the instance.
   * @returns A WorkbenchJupyterServer object compatible with the Jupyter
   * extension.
   */
  private createWorkbenchJupyterServer(
    instance: IInstance,
    projectId: string,
  ): WorkbenchJupyterServer {
    const proxyUri = instance.proxyUri ?? '';
    const id = instance.id ?? UNKNOWN_ID;
    const name = instance.name?.split('/').pop() ?? UNKNOWN_NAME;

    return {
      id,
      label: `${name} (${projectId})`,
      name,
      projectId,
      proxyUri,
    };
  }
}
