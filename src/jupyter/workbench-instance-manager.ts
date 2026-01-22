/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";
import { JupyterServer } from "@vscode/jupyter-extension";
import vscode, { Disposable } from "vscode";
import { AUTHORIZATION_HEADER } from "../colab/headers";
import { NotebooksClient } from "../workbench/notebooks-client";

import IInstance = protos.google.cloud.notebooks.v2.IInstance;

const UNKNOWN_ID = "UNKNOWN_ID";
const UNKNOWN_NAME = "UNKNOWN_NAME";
const UNKNOWN_STATE = "UNKNOWN_STATE";

export interface WorkbenchJupyterServer extends JupyterServer {
  name: string;
  projectId: string;
  state: string;
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
  ) {}

  /**
   * Loads Workbench instances for a specific project.
   *
   * This method fetches instances from the Notebooks API, converts them into
   * WorkbenchJupyterServer objects, and updates the internal list of servers.
   *
   * @param projectId - The ID of the GCP project.
   */
  async loadWorkbenchServers(projectId: string) {
    const instances = await this.notebooksClient.listInstances(projectId);
    this.workbenchServers = instances.map((instance) =>
      this.createWorkbenchJupyterServer(instance, projectId),
    );
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
  async refreshConnection(
    id: string,
    projectId: string,
  ): Promise<WorkbenchJupyterServer> {
    const [accessToken] = await Promise.all([
      this.getAccessToken(),
      this.loadWorkbenchServers(projectId),
    ]);
    const server = this.workbenchServers.find((s) => s.id === id);

    if (!server) {
      throw new Error(
        `Server with ID ${id} no longer exists in the project ${projectId}`,
      );
    }

    return this.enrichServerWithConnectionInfo(server, accessToken);
  }

  /**
   * Returns the list of currently loaded Workbench Jupyter servers.
   *
   * @returns An array of WorkbenchJupyterServer objects.
   */
  getWorkbenchServers(): WorkbenchJupyterServer[] {
    return this.workbenchServers;
  }

  /**
   * Disposes of the resources held by the manager.
   *
   * Clears the internal list of Workbench servers.
   */
  dispose() {
    this.workbenchServers = [];
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
    const name = instance.name?.split("/").pop() ?? UNKNOWN_NAME;
    const state = instance.state?.toString() ?? UNKNOWN_STATE;

    return {
      id,
      label: `${name} (${projectId}) [${state}]`,
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
      },
    };
  }
}
