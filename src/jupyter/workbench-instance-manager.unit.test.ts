/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import "../test/helpers/vscode";

import { protos } from "@google-cloud/notebooks";
import { assert, expect } from "chai";
import sinon from "sinon";
import { SinonStubbedInstance } from "sinon";
import { newVsCodeStub, VsCodeStub } from "../test/helpers/vscode";
import { NotebooksClient } from "../workbench/notebooks-client";
import { WorkbenchInstanceManager } from "./workbench-instance-manager";

import IInstance = protos.google.cloud.notebooks.v2.IInstance;
import State = protos.google.cloud.notebooks.v2.State;

describe("WorkbenchInstanceManager", () => {
  let vsCodeStub: VsCodeStub;
  let notebooksClientStub: SinonStubbedInstance<NotebooksClient>;
  let getAccessTokenStub: sinon.SinonStub<[], Promise<string>>;
  let manager: WorkbenchInstanceManager;

  const PROJECT_ID = "test-project";
  const INSTANCE_ID = "test-instance-id";
  const INSTANCE_NAME = "projects/test-project/locations/us-central1-a/instances/test-instance";
  const PROXY_URI = "test-proxy-uri";
  const ACCESS_TOKEN = "test-access-token";

  const MOCK_INSTANCE: IInstance = {
    id: INSTANCE_ID,
    name: INSTANCE_NAME,
    state: State.ACTIVE,
    proxyUri: PROXY_URI,
  };

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    notebooksClientStub = sinon.createStubInstance(NotebooksClient);
    getAccessTokenStub = sinon.stub();

    manager = new WorkbenchInstanceManager(
      vsCodeStub.asVsCode(),
      notebooksClientStub,
      getAccessTokenStub
    );
  });

  afterEach(() => {
    sinon.restore();
    manager.dispose();
  });

  describe("loadWorkbenchServers", () => {
    it("should fetch and convert servers correctly", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);

      const servers = await manager.loadWorkbenchServers(PROJECT_ID);

      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.name).to.equal("test-instance");
      expect(server.projectId).to.equal(PROJECT_ID);
      expect(server.state).to.equal(State.ACTIVE);
      expect(server.proxyUri).to.equal(PROXY_URI);
      expect(server.label).to.equal(`test-instance (test-project)`);
    });

    it("should handle empty instance list", async () => {
      notebooksClientStub.listInstances.resolves([]);

      const servers = await manager.loadWorkbenchServers(PROJECT_ID);

      expect(servers).to.have.lengthOf(0);
    });

    it("should handle instances with missing fields (defaults)", async () => {
      notebooksClientStub.listInstances.resolves([{
        // Empty instance
      }]);

      const servers = await manager.loadWorkbenchServers(PROJECT_ID);

      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal("UNKNOWN_ID");
      expect(server.name).to.equal("UNKNOWN_NAME");
      expect(server.state).to.equal(State.STATE_UNSPECIFIED);
      expect(server.proxyUri).to.equal("");
    });

    it("should use stored projectId if none provided", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);

      const servers = await manager.loadWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      expect(servers[0].projectId).to.equal(PROJECT_ID);
    });

    it("should return empty if no projectId provided or stored", async () => {
      const servers = await manager.loadWorkbenchServers();
      expect(servers).to.have.lengthOf(0);
    });

    it("should fire onDidChangeServers event after loading", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      const eventSpy = sinon.spy();
      manager.onDidChangeServers(eventSpy);

      await manager.loadWorkbenchServers(PROJECT_ID);

      sinon.assert.calledOnce(eventSpy);
    });
  });

  describe("getWorkbenchServers", () => {
    it("should return cached servers (default all)", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      expect(servers[0].id).to.equal(INSTANCE_ID);
      expect(servers[0].connectionInformation).to.exist;
      expect(
        servers[0].connectionInformation?.headers["Authorization"],
      ).to.equal(`Bearer ${ACCESS_TOKEN}`);
    });

    it("should return only active servers when filter is 'active'", async () => {
      const activeInstance = { ...MOCK_INSTANCE, id: 'active', state: State.ACTIVE };
      const stoppedInstance = { ...MOCK_INSTANCE, id: 'stopped', state: State.STOPPED };
      notebooksClientStub.listInstances.resolves([
        activeInstance,
        stoppedInstance,
      ]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = await manager.getWorkbenchServers('active');

      expect(servers).to.have.lengthOf(1);
      expect(servers[0].id).to.equal('active');
    });

    it("should return only inactive servers when filter is 'inactive'", async () => {
      const activeInstance = { ...MOCK_INSTANCE, id: 'active', state: State.ACTIVE };
      const stoppedInstance = { ...MOCK_INSTANCE, id: 'stopped', state: State.STOPPED };
      notebooksClientStub.listInstances.resolves([
        activeInstance,
        stoppedInstance,
      ]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = await manager.getWorkbenchServers('inactive');

      expect(servers).to.have.lengthOf(1);
      expect(servers[0].id).to.equal('stopped');
    });

    it("should return all servers when filter is 'all'", async () => {
      const activeInstance = { ...MOCK_INSTANCE, id: 'active', state: State.ACTIVE };
      const stoppedInstance = { ...MOCK_INSTANCE, id: 'stopped', state: State.STOPPED };
      notebooksClientStub.listInstances.resolves([
        activeInstance,
        stoppedInstance,
      ]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = await manager.getWorkbenchServers('all');

      expect(servers).to.have.lengthOf(2);
    });

    it(
      "should return correctly even if load was called with specific project ID distinct from stored",
      async () => {
    // logic: loadWorkbenchServers updates cache regardless of stored
    // projectId
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      await manager.loadWorkbenchServers('other-project');
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      const servers = await manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(1);
      expect(servers[0].projectId).to.equal('other-project');
    });

    it("should return servers with updated connection info", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);
      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      expect(servers[0].connectionInformation).to.exist;
    });
  });

  describe("refreshConnection", () => {
    it("should refresh connection and enrich server with token", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);

      const server = await manager.refreshConnection(INSTANCE_ID, PROJECT_ID);

      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.connectionInformation).to.exist;
      expect(server.connectionInformation?.baseUrl.toString()).to.equal(`https://${PROXY_URI.toLowerCase()}/`);
      expect(server.connectionInformation?.headers["Authorization"]).to.equal(`Bearer ${ACCESS_TOKEN}`);
      expect(server.connectionInformation?.headers['X-XSRFToken']).to.equal('XSRF');

      sinon.assert.calledWith(notebooksClientStub.listInstances, PROJECT_ID);
      sinon.assert.calledOnce(getAccessTokenStub);
    });

    it("should throw error if server is not found after reload", async () => {
      notebooksClientStub.listInstances.resolves([]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);

      try {
        await manager.refreshConnection(INSTANCE_ID, PROJECT_ID);
        assert.fail("Should have thrown error");
      } catch (e: unknown) {
        if (e instanceof Error) {
          expect(e.message).to.contain(`Server with ID ${INSTANCE_ID} no longer exists`);
        } else {
          throw e;
        }
      }
    });

    it("should make parallel calls to listInstances and getAccessToken", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);

      await manager.refreshConnection(INSTANCE_ID, PROJECT_ID);

      sinon.assert.calledOnce(notebooksClientStub.listInstances);
      sinon.assert.calledOnce(getAccessTokenStub);
    });
  });

  describe("dispose", () => {
    it("should clear the project id", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);
      expect(await manager.loadWorkbenchServers()).to.have.lengthOf(1);

      manager.dispose();

      expect(await manager.getWorkbenchServers()).to.have.lengthOf(0);
    });
  });
});
