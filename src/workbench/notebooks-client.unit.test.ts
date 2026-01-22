/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { v2, protos } from "@google-cloud/notebooks";
import { expect } from "chai";
import { OAuth2Client } from "google-auth-library";
import * as sinon from "sinon";
import { NotebooksClient } from "./notebooks-client";

const DEFAULT_INSTANCES_RESPONSE: protos.google.cloud.notebooks.v2.IInstance[] =
  [
  {
    name: "projects/mock-project-id/locations/mock-location/instances/mock-instance-1",
    gceSetup: {
      machineType: "https://www.googleapis.com/compute/v1/projects/mock-project-id/zones/mock-zone/machineTypes/mock-machine-type",
      metadata: {
        "proxy-url": "mock-proxy-url-1",
      },
    },
    proxyUri: "mock-proxy-url-1",
    state: "STOPPED",
    createTime: { seconds: 1758143138, nanos: 454383910 },
    updateTime: { seconds: 1763919346, nanos: 100834445 },
  },
  {
    name: "projects/mock-project-id/locations/mock-location/instances/mock-instance-2",
    gceSetup: {
      machineType: "https://www.googleapis.com/compute/v1/projects/mock-project-id/zones/mock-zone/machineTypes/mock-machine-type",
      metadata: {
        "proxy-url": "mock-proxy-url-2",
      },
    },
    proxyUri: "mock-proxy-url-2",
    state: "STOPPED",
    createTime: { seconds: 1758831235, nanos: 470129454 },
    updateTime: { seconds: 1763909167, nanos: 403311244 },
  },
];


describe("NotebooksClient", () => {
  let client: NotebooksClient;
  let listInstancesStub: sinon.SinonStubbedInstance<v2.NotebookServiceClient>;
  let mockAuthClient: OAuth2Client;

  beforeEach(() => {
    mockAuthClient = new OAuth2Client();
    listInstancesStub = sinon.createStubInstance(v2.NotebookServiceClient);
    client = new NotebooksClient(mockAuthClient);

    // Inject the stub into the client instance since it creates its own
    // instance internally
    Object.defineProperty(client, "notebookServiceClient", {
      value: listInstancesStub,
      writable: true,
    });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe("listInstances", () => {
    it("should return a list of instances", async () => {
      const projectId = "mock-project-id";
      listInstancesStub.listInstances.resolves([DEFAULT_INSTANCES_RESPONSE]);

      const instances = await client.listInstances(projectId);

      expect(instances).to.have.lengthOf(2);
      expect(instances).to.deep.equal(DEFAULT_INSTANCES_RESPONSE);

      expect(listInstancesStub.listInstances.calledOnce).to.be.true;
      const request = listInstancesStub.listInstances.getCall(0).args[0];
      expect(request.parent).to.equal(`projects/${projectId}/locations/-`);
    });

    it("rejects when error responses are returned", async () => {
      const projectId = "mock-project-id";
      const error = new Error("List failed");
      listInstancesStub.listInstances.rejects(error);

      await expect(client.listInstances(projectId)).to.be.rejectedWith(error);
    });
  });
});
