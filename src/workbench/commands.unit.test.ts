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

  it("sets project ID and triggers kernel selection when project is chosen", async () => {
    getOrCreateSessionStub.resolves({ accessToken: "token" });

    // Mock MultiStepInput.run to simulate setting selectedProject
    multiStepRunStub.callsFake(async (_vs, _inputStep) => {
      // We can't easily execute the inputStep to set the local variable 'selectedProject'
      // because it's inside the function closure.
      // However, we can modify how we test this.
      // Since we can't inject the selection into the closure, we might need to rely on
      // the fact that MultiStepInput.run would have been called.
      // Actually, to test the behavior AFTER run(), we need to simulate the effect of run().
      // But we can't set the local variable `selectedProject`.

      // WAIT: The test imports `selectProjectCommand` from the module.
      // The `selectedProject` variable is local to the function scope of `selectProjectCommand`.
      // If we can't control the local variable, we can't test the 'success' path easily with a stubbed `run`.

      // Alternative: We can mock `input.showQuickPick` if we can get a handle to the `input` object passed to `pickProject`.
      // `pickProject` is passed to `MultiStepInput.run`.
      const pickProject = multiStepRunStub.firstCall.args[1];
      const inputStub = {
        showQuickPick: sinon.stub().resolves({ label: "Project", detail: "p-id" })
      };
      await pickProject(inputStub);
    });

    // We also need to mock vscode.commands.executeCommand
    const executeCommandStub = sinon.stub(vsCodeStub.commands, "executeCommand").resolves();

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(instanceManagerStub.setProjectId, "p-id");
    sinon.assert.calledWith(executeCommandStub, "notebook.selectKernel");
  });
});
