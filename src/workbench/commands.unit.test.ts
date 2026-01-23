/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Module } from "module";
import * as sinon from "sinon";
import vscode from "vscode";
import { GoogleAuthProvider } from "../auth/auth-provider";
import { MultiStepInput } from "../common/multi-step-quickpick";
import { InputStep } from "../common/multi-step-quickpick";
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

    getOrCreateSessionStub = sinon.stub(
      GoogleAuthProvider,
      "getOrCreateSession",
    );
    multiStepRunStub = sinon.stub(MultiStepInput, "run");

    resourceManagerStub.getProjects.resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  it("initiates project selection", async () => {
    multiStepRunStub.resolves();

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(multiStepRunStub, vsCodeStub, sinon.match.func);
  });

  it("sets project ID when project is chosen", async () => {
    getOrCreateSessionStub.resolves({ accessToken: "token" });

    // Mock MultiStepInput.run to simulate setting selectedProject
    multiStepRunStub.callsFake(async (_vs, _inputStep) => {
      const pickProject = multiStepRunStub.firstCall.args[1] as InputStep;
      const inputStub = {
        showQuickPick: sinon
          .stub()
          .resolves({ label: "Project", detail: "p-id" }),
      };
      await pickProject(inputStub as unknown as MultiStepInput);
    });

    // executingCommand is already stubbed by newVsCodeStub
    const executeCommandStub = vsCodeStub.commands
      .executeCommand as unknown as sinon.SinonStub;

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(instanceManagerStub.setProjectId, "p-id");
    sinon.assert.notCalled(executeCommandStub);
  });
});
