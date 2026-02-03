/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v3 } from '@google-cloud/resource-manager';
import { expect } from 'chai';
import { OAuth2Client } from 'google-auth-library';
import * as sinon from 'sinon';
import vscode from 'vscode';
import { ProjectsClient } from './projects-client';

const DEFAULT_PROJECTS_RESPONSE = [
  {
    labels: {
      provisioned_project_prefix: 'mock-provisioned-prefix',
    },
    name: 'projects/mock-project-number-1',
    parent: 'folders/mock-folder-id',
    projectId: 'mock-project-id-1',
    state: 'ACTIVE',
    displayName: 'mock-display-name-1',
  },
  {
    labels: {},
    name: 'projects/mock-project-number-2',
    parent: 'folders/mock-folder-id',
    projectId: 'mock-project-id-2',
    state: 'ACTIVE',
    displayName: '',
  },
  {
    labels: {
      provisioned_project_prefix: 'mock-provisioned-prefix-2',
    },
    name: 'projects/mock-project-number-3',
    parent: 'folders/mock-folder-id',
    projectId: 'mock-project-id-3',
    state: 'ACTIVE',
    displayName: 'mock-display-name-3',
  },
];

describe('ProjectsClient', () => {
  let client: ProjectsClient;
  let searchProjectsStub: sinon.SinonStubbedInstance<v3.ProjectsClient>;
  let mockAuthClient: OAuth2Client;

  beforeEach(() => {
    mockAuthClient = new OAuth2Client();

    client = new ProjectsClient(mockAuthClient);
    searchProjectsStub = sinon.createStubInstance(v3.ProjectsClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getProjects', () => {
    beforeEach(() => {
      // Inject the stub into the client instance since it creates its own
      // instance internally
      Object.defineProperty(client, 'projectClient', {
        value: searchProjectsStub,
        writable: true,
      });
      (vscode.window.showErrorMessage as sinon.SinonStub).resetHistory();
    });

    it('should return a list of projects', async () => {
      searchProjectsStub.searchProjects.resolves([
        DEFAULT_PROJECTS_RESPONSE,
        null,
        null,
      ]);

      const projects = await client.getProjects('test-query');

      expect(projects).to.have.lengthOf(3);
      expect(projects[0]).to.deep.equal({
        id: 'mock-project-id-1',
        name: 'mock-display-name-1',
      });
      expect(projects[2]).to.deep.equal({
        id: 'mock-project-id-3',
        name: 'mock-display-name-3',
      });

      expect(searchProjectsStub.searchProjects.calledOnce).to.be.true;
      const requestArgs = searchProjectsStub.searchProjects.firstCall.args[0];
      expect(requestArgs.query).to.contain('test-query');
      expect(requestArgs.query).to.contain('state:ACTIVE');
    });

    it('should throw an error if searchProjects fails', async () => {
      const error = new Error('Search failed');
      searchProjectsStub.searchProjects.rejects(error);

      await expect(client.getProjects('test-query')).to.be.rejectedWith(
        'Search failed',
      );
      sinon.assert.notCalled(vscode.window.showErrorMessage as sinon.SinonStub);
    });
  });
});
