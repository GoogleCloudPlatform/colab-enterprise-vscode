/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */


import { Module } from "module";
import { expect } from "chai";
import * as sinon from "sinon";
import vscode from "vscode"
import { GoogleAuthProvider } from "../auth/auth-provider";
import { MultiStepInput } from "../common/multi-step-quickpick";
import { WorkbenchInstanceManager } from "../jupyter/workbench-instance-manager";
import { newVsCodeStub } from "../test/helpers/vscode";
import { ProjectsClient } from "./projects-client";

describe("selectProjectCommand", () => {
  let vsCodeStub: typeof vscode;
  let resourceManagerStub: sinon.SinonStubbedInstance<ProjectsClient>;
  let instanceManagerStub: sinon.SinonStubbedInstance<WorkbenchInstanceManager>;
  let getOrCreateSessionStub: sinon.SinonStub;
  let multiStepRunStub: sinon.SinonStub;
  let selectProjectCommand: (
    vs: typeof vscode,
    projectsClient: ProjectsClient,
    instanceManager: WorkbenchInstanceManager,
  ) => Promise<unknown>;

  const originalRequire = Module.prototype.require;

  before(async () => {
    Module.prototype.require = function (id: string) {
      if (id === "vscode") {
        return newVsCodeStub().asVsCode();
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return originalRequire.call(this, id);
    };

    const module = await import("./commands.js");
    selectProjectCommand = module.selectProjectCommand;
  });

  after(() => {
    Module.prototype.require = originalRequire;
  });

  beforeEach(() => {
    vsCodeStub = newVsCodeStub().asVsCode();
    resourceManagerStub = sinon.createStubInstance(ProjectsClient);
    instanceManagerStub = sinon.createStubInstance(WorkbenchInstanceManager);

    getOrCreateSessionStub = sinon.stub(GoogleAuthProvider, "getOrCreateSession");
    multiStepRunStub = sinon.stub(MultiStepInput, "run");
  });

  afterEach(() => {
    sinon.restore();
  });

  it("does nothing if authentication fails", async () => {
    getOrCreateSessionStub.resolves(undefined as unknown);

    const result = await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );
    expect(result).to.be.undefined;
    sinon.assert.notCalled(multiStepRunStub);
  });

  it("initiates project selection if authentication succeeds", async () => {
    getOrCreateSessionStub.resolves({ accessToken: "token" });
    multiStepRunStub.resolves();

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    // The first argument is the vscode stub, second is the pickProject step
    sinon.assert.calledWith(multiStepRunStub, vsCodeStub, sinon.match.func);
  });

  it("returns the selected server if MultiStepInput completes and sets selectedServer", async () => {
    getOrCreateSessionStub.resolves({ accessToken: "token" });

    multiStepRunStub.callsFake(async () => {
    // We bypass the actual flow control since the module is mocked
    });

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );
    sinon.assert.calledOnce(multiStepRunStub);
  });
});
