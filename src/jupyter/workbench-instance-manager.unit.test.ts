/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { protos } from "@google-cloud/notebooks";
import { assert, expect } from "chai";
import sinon from "sinon";
import { SinonStubbedInstance } from "sinon";
import { AUTHORIZATION_HEADER } from "../colab/headers";
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
  const INSTANCE_NAME =
    "projects/test-project/locations/us-central1-a/instances/test-instance";
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
      getAccessTokenStub,
    );
  });

  afterEach(() => {
    sinon.restore();
    manager.dispose();
  });

  describe("loadWorkbenchServers", () => {
    it("should load servers and convert assignments correctly", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);

      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.name).to.equal("test-instance");
      expect(server.projectId).to.equal(PROJECT_ID);
      expect(server.state).to.equal(State.ACTIVE.toString());
      expect(server.proxyUri).to.equal(PROXY_URI);
      expect(server.label).to.equal(
        `test-instance (test-project) [${State.ACTIVE.toString()}]`,
      );
    });

    it("should handle empty instance list", async () => {
      notebooksClientStub.listInstances.resolves([]);

      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(0);
    });

    it("should handle instances with missing fields (defaults)", async () => {
      notebooksClientStub.listInstances.resolves([
        {
          // Empty instance
        },
      ]);

      await manager.loadWorkbenchServers(PROJECT_ID);

      const servers = manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal("UNKNOWN_ID");
      expect(server.name).to.equal("UNKNOWN_NAME");
      expect(server.state).to.equal("UNKNOWN_STATE");
      expect(server.proxyUri).to.equal("");
    });
  });

  describe("refreshConnection", () => {
    it("should refresh connection and enrich server with token", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      getAccessTokenStub.resolves(ACCESS_TOKEN);

      const server = await manager.refreshConnection(INSTANCE_ID, PROJECT_ID);

      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.connectionInformation).to.exist;
      expect(server.connectionInformation?.baseUrl.toString()).to.equal(
        `https://${PROXY_URI.toLowerCase()}/`,
      );
      expect(
        server.connectionInformation?.headers[AUTHORIZATION_HEADER.key],
      ).to.equal(`Bearer ${ACCESS_TOKEN}`);
      expect(server.connectionInformation?.headers["X-XSRFToken"]).to.equal(
        "XSRF",
      );

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
          expect(e.message).to.contain(
            `Server with ID ${INSTANCE_ID} no longer exists`,
          );
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

  describe("getWorkbenchServers", () => {
    it("should return the list of servers", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      await manager.loadWorkbenchServers(PROJECT_ID);

      expect(manager.getWorkbenchServers()).to.have.lengthOf(1);
    });
  });

  describe("dispose", () => {
    it("should clear the server list", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      await manager.loadWorkbenchServers(PROJECT_ID);
      expect(manager.getWorkbenchServers()).to.have.lengthOf(1);

      manager.dispose();

      expect(manager.getWorkbenchServers()).to.have.lengthOf(0);
    });
  });
});
