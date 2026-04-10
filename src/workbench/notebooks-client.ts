/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v2, protos } from '@google-cloud/notebooks';
import { OAuth2Client } from 'google-auth-library';
import { getWorkbenchClientHeaderWithVersion } from './headers';

/**
 * Client for interacting with the Google Cloud Notebooks API.
 */
export class NotebooksClient {
  private readonly notebookServiceClient: v2.NotebookServiceClient;

  /**
   * @param authClient - An OAuth2Client instance used for authentication.
   */
  constructor(authClient: OAuth2Client) {
    this.notebookServiceClient = new v2.NotebookServiceClient({
      authClient,
      otherArgs: {
        headers: {
          [getWorkbenchClientHeaderWithVersion().key]:
            getWorkbenchClientHeaderWithVersion().value,
        },
      },
    });
  }

  /**
   * Lists Workbench instances for a specific project.
   *
   * @param projectId - The ID of the GCP project.
   * @returns A promise resolving to a list of Workbench instances.
   */
  async listInstances(
    projectId: string,
  ): Promise<protos.google.cloud.notebooks.v2.IInstance[]> {
    const request = {
      parent: `projects/${projectId}/locations/-`,
      filter: 'state="ACTIVE"',
    };

    const [instances] = await this.notebookServiceClient.listInstances(request);

    return instances;
  }
}
