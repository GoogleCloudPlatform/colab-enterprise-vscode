/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v3 } from '@google-cloud/resource-manager';
import { OAuth2Client } from 'google-auth-library';
import { getWorkbenchClientHeaderWithVersion } from './headers';

/**
 * The number of projects to retrieve per page.
 */
const PROJECTS_PER_PAGE = 50;

/**
 * Represents a Google Cloud Platform project.
 */
export interface GCPProject {
  /** The unique ID of the project. */
  id: string;
  /** The display name of the project. */
  name: string;
}

/**
 * Client for interacting with Google Cloud Resource Manager.
 */
export class ProjectsClient {
  private projectClient: v3.ProjectsClient;

  /**
   * @param authClient - An OAuth2Client instance used for authentication with
   * Google Cloud services.
   */
  constructor(authClient: OAuth2Client) {
    this.projectClient = new v3.ProjectsClient({
      authClient: authClient,
      otherArgs: {
        headers: {
          [getWorkbenchClientHeaderWithVersion().key]:
            getWorkbenchClientHeaderWithVersion().value,
        },
      },
    });
  }

  /**
   * Lists GCP projects matching the query.
   *
   * @param query - Optional query string to filter projects by ID or name.
   * @returns A promise resolving to a list of GCP projects.
   */
  async getProjects(query = ''): Promise<GCPProject[]> {
    const escapedQuery = query.replace(/"/g, '\\"');
    const request = {
      pageSize: PROJECTS_PER_PAGE,
      query: `(id:"*${escapedQuery}*" OR name:"*${escapedQuery}*") AND state:ACTIVE`,
    };

    const [projectsList] = await this.projectClient.searchProjects(request, {
      autoPaginate: false,
    });

    return projectsList
      .filter((project) => project.projectId)
      .map((project) => ({
        id: project.projectId ?? '',
        name: project.displayName ?? project.projectId ?? '',
      }));
  }
}
