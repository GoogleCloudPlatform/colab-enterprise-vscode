/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";
import { JupyterServer } from "@vscode/jupyter-extension";
import vscode, { Disposable } from "vscode";
import { AUTHORIZATION_HEADER } from "../colab/headers";
import { NotebooksClient } from "../workbench/notebooks-client";

import State = protos.google.cloud.notebooks.v2.State;
import IInstance = protos.google.cloud.notebooks.v2.IInstance;

const UNKNOWN_ID = "UNKNOWN_ID";
const UNKNOWN_NAME = "UNKNOWN_NAME";

export interface WorkbenchJupyterServer extends JupyterServer {
  name: string;
  projectId: string;
  /** The state of the instance (e.g., "ACTIVE", "STOPPED"). */
  state: State;
  /** The proxy URI for connecting to the Jupyter server. */
  proxyUri: string;
  connectionInformation?: {
    baseUrl: vscode.Uri;
    headers: {
      [AUTHORIZATION_HEADER.key]: string;
      Cookie: string;
      "X-XSRFToken": string;
      Origin: string;
    };
  };
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
export class WorkbenchInstanceManager implements Disposable {
  private projectId: string | undefined;
  private workbenchServers: WorkbenchJupyterServer[] = [];

  /**
   * Creates a new instance of WorkbenchInstanceManager.
   *
   * @param vs - The VS Code API instance.
   * @param notebooksClient - The client for interacting with the Notebooks API.
   * @param getAccessToken - A function that returns a promise resolving to an
   * access token.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly notebooksClient: NotebooksClient,
    private readonly getAccessToken: () => Promise<string>,
  ) {
    this.serverChangeEmitter = new this.vs.EventEmitter<void>();
    this.onDidChangeServers = this.serverChangeEmitter.event;
  }

  readonly onDidChangeServers: vscode.Event<void>;
  private readonly serverChangeEmitter: vscode.EventEmitter<void>;


  /**
   * Sets the current GCP project ID.
   *
   * @param projectId - The ID of the GCP project.
   */
  setProjectId(projectId: string) {
    this.projectId = projectId;
  }



  /**
   * Refreshes the connection information for a server.
   *
   * This method reloads the server list and fetches a fresh access token to
   * ensure the connection information is up-to-date. This is typically used
   * when retrieving or refreshing kernels.
   *
   * @param id - The ID of the assigned server to refresh.
   * @param projectId - The ID of the GCP project.
   * @returns The server with updated connection information.
   * @throws If the server with the given ID no longer exists in the project.
   */
  async refreshConnection(id: string, projectId: string): Promise<WorkbenchJupyterServer> {
    const [accessToken, servers] = await Promise.all([
      this.getAccessToken(),
      this.loadWorkbenchServers(projectId),
    ]);
    const server = servers.find(s => s.id === id);

    if (!server) {
      throw new Error(`Server with ID ${id} no longer exists in the project ${projectId}`);
    }

    return this.enrichServerWithConnectionInfo(server, accessToken);
  }

  /**
   * Returns the cached list of Workbench Jupyter servers.
   *
   * @returns An array of WorkbenchJupyterServer objects.
   */
  async getWorkbenchServers(
    filter: 'active' | 'inactive' | 'all' = 'all',
  ): Promise<WorkbenchJupyterServer[]> {
    const token = await this.getAccessToken();

    if (filter === 'active') {
      this.workbenchServers = this.workbenchServers.filter(
        (s) => s.state === State.ACTIVE,
      );
    } else if (filter === 'inactive') {
      this.workbenchServers = this.workbenchServers.filter(
        (s) => s.state !== State.ACTIVE,
      );
    }

    return this.workbenchServers.map(server =>
      this.enrichServerWithConnectionInfo(server, token),
    );
  }

  /**
   * Fetches the list of Workbench Jupyter servers from the API and updates the
   * cache.
   *
   * @param projectId - Optional project ID to fetch for. Defaults to current
   * project ID.
   * @returns An array of WorkbenchJupyterServer objects.
   */
  async loadWorkbenchServers(
    projectId?: string,
  ): Promise<WorkbenchJupyterServer[]> {
    const targetProject = projectId ?? this.projectId;
    if (!targetProject) {
      this.workbenchServers = [];
      return [];
    }

    try {
      const instances = await this.notebooksClient.listInstances(targetProject);
      this.workbenchServers = instances.map((instance) =>
        this.createWorkbenchJupyterServer(instance, targetProject),
      );
      this.serverChangeEmitter.fire();
      return this.workbenchServers;
    } catch (error) {
      console.error(
        `Failed to fetch workbench servers for project ${targetProject}:`,
        error,
      );
      this.workbenchServers = [];
      this.serverChangeEmitter.fire();
      return [];
    }
  }

  /**
   * Disposes of the resources held by the manager.
   *
   * Clears the internal list of Workbench servers.
   */
  dispose() {
    this.projectId = undefined;
    this.workbenchServers = [];
    this.serverChangeEmitter.dispose();
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
    const proxyUri = instance.proxyUri ?? "";
    const id = instance.id ?? UNKNOWN_ID;
    const name = instance.name?.split('/').pop() ?? UNKNOWN_NAME;

    let state: State = State.STATE_UNSPECIFIED;
    if (typeof instance.state === 'string') {
      // If state is a string key (e.g. "ACTIVE"), convert to enum
      const maybeState = State[instance.state];
      if (typeof maybeState === 'number') {
        state = maybeState;
      }
    } else if (typeof instance.state === 'number') {
      state = instance.state;
    }

    return {
      id,
      label: `${name} (${projectId})`,
      name,
      state,
      projectId,
      proxyUri,
    };
  }

  /**
   * Enriches a WorkbenchJupyterServer with connection information.
   *
   * Adds the base URL and authorization headers (including the access token)
   * required to connect to the Jupyter server.
   *
   * @param server - The WorkbenchJupyterServer to enrich.
   * @param accessToken - The Google Cloud access token.
   * @returns A new WorkbenchJupyterServer object with connection information.
   */
  private enrichServerWithConnectionInfo(
    server: WorkbenchJupyterServer,
    accessToken: string,
  ): WorkbenchJupyterServer {
    const baseUrlString = `https://${server.proxyUri}`;
    const baseUrl = this.vs.Uri.parse(baseUrlString);

    const headers = {
      [AUTHORIZATION_HEADER.key]: `Bearer ${accessToken}`,
      Cookie: "_xsrf=XSRF",
      "X-XSRFToken": "XSRF",
      Origin: baseUrlString,
    };

    return {
      ...server,
      connectionInformation: {
        baseUrl,
        headers,
      }
    };
  }
}