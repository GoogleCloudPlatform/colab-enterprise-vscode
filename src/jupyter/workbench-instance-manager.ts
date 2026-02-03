/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";
import { JupyterServer } from "@vscode/jupyter-extension";
import vscode from "vscode";
import { withError } from "../utils/errors";
import { AUTHORIZATION_HEADER } from "../workbench/headers";
import { NotebooksClient } from "../workbench/notebooks-client";

import IInstance = protos.google.cloud.notebooks.v2.IInstance;

const UNKNOWN_ID = "UNKNOWN_ID";
const UNKNOWN_NAME = "UNKNOWN_NAME";

export interface WorkbenchJupyterServer extends JupyterServer {
  name: string;
  projectId: string;
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
   * @param getAccessToken - A function that returns a promise resolving to an
   * access token.
   */
  constructor(
    private readonly vs: typeof vscode,
    private readonly notebooksClient: NotebooksClient,
    private readonly getAccessToken: () => Promise<string>,
  ) {}

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
  async refreshConnection(
    workbenchServer: WorkbenchJupyterServer,
  ): Promise<WorkbenchJupyterServer> {
    const accessToken = await this.getAccessToken();
    return this.enrichServerWithConnectionInfo(workbenchServer, accessToken);
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
        title: "Fetching Workbench instances...",
        cancellable: false,
      },
      () =>
        withError(
          /* operation= */ () => this.notebooksClient.listInstances(projectId),
          /* defaultValue= */ [],
          /* errorMessage= */ "Failed to list Workbench instances",
        ),
    );
    this.cachedServers = instances.map((instance) =>
      this.createWorkbenchJupyterServer(instance, projectId),
    );
    this.shouldRefresh = false;

    if (this.cachedServers.length === 0) {
      this.vs.window.showInformationMessage(
        `No Workbench instances found in project: ${projectId}.`,
      );
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
    const proxyUri = instance.proxyUri ?? "";
    const id = instance.id ?? UNKNOWN_ID;
    const name = instance.name?.split("/").pop() ?? UNKNOWN_NAME;

    return {
      id,
      label: `${name} (${projectId})`,
      name,
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
