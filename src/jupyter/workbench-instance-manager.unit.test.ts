/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import "../test/helpers/vscode";

import { protos } from "@google-cloud/notebooks";
import { expect } from "chai";
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

  const MOCK_SERVER = {
    id: INSTANCE_ID,
    name: "test-instance",
    projectId: PROJECT_ID,
    label: `test-instance (${PROJECT_ID})`,
    proxyUri: PROXY_URI,
    connectionInformation: undefined,
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

  describe("getWorkbenchServers", () => {
    it("should return empty list if no projectId is set", async () => {
      const servers = await manager.getWorkbenchServers();
      expect(servers).to.have.lengthOf(0);
    });

    it("should fetch and convert servers correctly when projectId is set", async () => {
      notebooksClientStub.listInstances.resolves([MOCK_INSTANCE]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(1);
      const server = servers[0];
      expect(server.id).to.equal(INSTANCE_ID);
      expect(server.name).to.equal("test-instance");
      expect(server.projectId).to.equal(PROJECT_ID);
      expect(server.proxyUri).to.equal(PROXY_URI);
      expect(server.label).to.equal(`test-instance (test-project)`);
      sinon.assert.calledWith(notebooksClientStub.listInstances, PROJECT_ID);
      sinon.assert.calledOnce(vsCodeStub.window.withProgress);
      sinon.assert.notCalled(vsCodeStub.window.showInformationMessage);
    });

    it("should handle empty instance list", async () => {
      notebooksClientStub.listInstances.resolves([]);
      manager.setProjectId(PROJECT_ID);
      manager.setShouldRefresh();

      const servers = await manager.getWorkbenchServers();

      expect(servers).to.have.lengthOf(0);
      sinon.assert.calledOnce(vsCodeStub.window.showInformationMessage);
    });

    it("should handle instances with missing fields (defaults)", async () => {
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
      expect(server.id).to.equal("UNKNOWN_ID");
      expect(server.name).to.equal("UNKNOWN_NAME");
      expect(server.proxyUri).to.equal("");
    });

    it("should cache servers after initial fetch", async () => {
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

    it("should refresh cache when setShouldRefresh is called", async () => {
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

  describe("refreshConnection", () => {
    it("should enrich server with token", async () => {
      getAccessTokenStub.resolves(ACCESS_TOKEN);

      // clone MOCK_SERVER to avoid modifying constant
      const serverInput = { ...MOCK_SERVER };

      const server = await manager.refreshConnection(serverInput);

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

      sinon.assert.calledOnce(getAccessTokenStub);
    });
  });
});
