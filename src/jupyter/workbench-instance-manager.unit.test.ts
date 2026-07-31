/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '../test/helpers/vscode';

import { protos } from '@google-cloud/notebooks';
import { expect } from 'chai';
import sinon from 'sinon';
import { SinonStubbedInstance } from 'sinon';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { AUTHORIZATION_HEADER } from '../workbench/headers';
import { NotebooksClient } from '../workbench/notebooks-client';
import {
  ConnectionRefresher,
  RefreshableConnection,
} from './connection-refresher';
import { WorkbenchInstanceManager } from './workbench-instance-manager';

import IInstance = protos.google.cloud.notebooks.v2.IInstance;
import State = protos.google.cloud.notebooks.v2.State;

/**
 * A lightweight fake {@link ConnectionRefresher} whose `refresh` stamps a
 * token into the connection, mirroring what the real refresher does on connect.
 */
interface FakeRefresher {
  refresh: sinon.SinonStub;
  dispose: sinon.SinonStub;
}

describe('WorkbenchInstanceManager', () => {
  let vsCodeStub: VsCodeStub;
  let notebooksClientStub: SinonStubbedInstance<NotebooksClient>;
  let refresher: FakeRefresher;
  let manager: WorkbenchInstanceManager;

  const PROJECT_ID = 'test-project';
  const INSTANCE_ID = 'test-instance-id';
  const INSTANCE_NAME =
    'projects/test-project/locations/us-central1-a/instances/test-instance';
  const PROXY_URI = 'test-proxy-uri';
  const ACCESS_TOKEN = 'test-access-token';

  const MOCK_INSTANCE: IInstance = {
    id: INSTANCE_ID,
    name: INSTANCE_NAME,
    state: State.ACTIVE,
    proxyUri: PROXY_URI,
  };

  const MOCK_SERVER = {
    id: INSTANCE_ID,
    name: 'test-instance',
    projectId: PROJECT_ID,
    label: `test-instance (${PROJECT_ID})`,
    proxyUri: PROXY_URI,
    connectionInformation: undefined,
  };

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    notebooksClientStub = sinon.createStubInstance(NotebooksClient);
    refresher = {
      // Mirror the real refresher: stamp a token into the connection in place.
      refresh: sinon
        .stub()
        .callsFake((_id: string, c: RefreshableConnection) => {
          c.token = ACCESS_TOKEN;
          c.tokenExpiry = new Date(Date.now() + 60 * 60 * 1000);
          c.headers[AUTHORIZATION_HEADER.key] = `Bearer ${ACCESS_TOKEN}`;
          return Promise.resolve();
        }),
      dispose: sinon.stub(),
    };

    manager = new WorkbenchInstanceManager(
      vsCodeStub.asVsCode(),
      notebooksClientStub,
      refresher as unknown as ConnectionRefresher,
    );

    vsCodeStub.window.withProgress.callsFake(async (_options, task) => {
      return task(
        {
          report: () => {
            /* empty */
          },
        },
        new vsCodeStub.CancellationTokenSource().token,
      );
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('getWorkbenchServers', () => {
    it('should return empty list if no projectId is set', async () => {
      const servers = await manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(0);
    });

    it('should fetch and convert servers correctly when projectId is set', async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.name).to.equal('test-instance');
      expect(server.projectId).to.equal(PROJECT_ID);
      expect(server.proxyUri).to.equal(PROXY_URI);
      expect(server.label).to.equal(`test-instance (test-project)`);
      sinon.assert.calledWith(notebooksClientStub.listInstances, PROJECT_ID);
      sinon.assert.calledOnce(vsCodeStub.window.withProgress);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it('should handle empty instance list', async () => {
      notebooksClientStub.listInstances.resolves([]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(0);
      sinon.assert.calledOnce(vsCodeStub.window.showInformationMessage);
    });

    it('should handle instances with missing fields (defaults)', async () => {
      notebooksClientStub.listInstances.resolves([
        {
          // Empty instance
        },
      ]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal('UNKNOWN_ID');
      expect(server.name).to.equal('UNKNOWN_NAME');
      expect(server.proxyUri).to.equal('');
    });

    it('should cache servers after initial fetch', async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      // First call fetches from API
      await manager.getWorkbenchServers();
      sinon.assert.calledOnce(notebooksClientStub.listInstances);

      // Second call should return cached
      const servers = await manager.getWorkbenchServers();
      sinon.assert.calledOnce(notebooksClientStub.listInstances); // Still called once
      expect(servers).to.have.lengthOf(1);
    });

    it('should refresh cache when setShouldRefresh is called', async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      // First call
      await manager.getWorkbenchServers();

      // Force refresh
      manager.setShouldRefresh();

      // Second call should fetch again
      await manager.getWorkbenchServers();
      sinon.assert.calledTwice(notebooksClientStub.listInstances);
    });
  });

  describe('refreshConnection', () => {
    it('should build per-server connection info with token and expiry', async () => {
      // clone MOCK_SERVER to avoid modifying constant
      const server = await manager.refreshConnection({ ...MOCK_SERVER });
      const connection = server.connectionInformation;

      expect(server.id).to.equal(INSTANCE_ID);
      expect(connection).to.exist;
      expect(connection?.baseUrl.toString()).to.equal(
        `https://${PROXY_URI.toLowerCase()}/`,
      );
      expect(connection?.token).to.equal(ACCESS_TOKEN);
      expect(connection?.tokenExpiry).to.be.instanceOf(Date);
      expect(connection?.headers[AUTHORIZATION_HEADER.key]).to.equal(
        `Bearer ${ACCESS_TOKEN}`,
      );
      expect(connection?.headers['X-XSRFToken']).to.equal('XSRF');
    });

    it('should keep fresh the exact connection object it returns so refreshes apply in place', async () => {
      const server = await manager.refreshConnection({ ...MOCK_SERVER });

      // The connection handed to the refresher is the same object returned, so
      // in-place token refreshes reach the live connection.
      sinon.assert.calledOnceWithExactly(
        refresher.refresh,
        INSTANCE_ID,
        server.connectionInformation,
      );
    });
  });
});
