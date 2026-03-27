/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Module } from 'module';
import { expect } from 'chai';
import * as sinon from 'sinon';
import vscode from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import {
  MultiStepInput,
  QuickPickOptions,
} from '../common/multi-step-quickpick';
import { InputStep } from '../common/multi-step-quickpick';
import {
  WorkbenchInstanceManager,
  WorkbenchJupyterServer,
} from '../jupyter/workbench-instance-manager';
import { newVsCodeStub } from '../test/helpers/vscode';
import { ProjectsClient } from './projects-client';

describe('selectProjectCommand', () => {
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
      if (id === 'vscode') {
        return newVsCodeStub().asVsCode();
      }
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return originalRequire.call(this, id);
    };

    const module = await import('./commands.js');
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
      'getOrCreateSession',
    );
    multiStepRunStub = sinon.stub(MultiStepInput, 'run');

    resourceManagerStub.getProjects.resolves([]);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('initiates project selection', async () => {
    multiStepRunStub.resolves();

    await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(multiStepRunStub, vsCodeStub, sinon.match.func);
  });

  it('sets project ID when project is chosen', async () => {
    getOrCreateSessionStub.resolves({ accessToken: 'token' });

    // Mock MultiStepInput.run to simulate setting selectedProject
    multiStepRunStub.callsFake(async (_vs, _inputStep) => {
      const pickProject = multiStepRunStub.firstCall.args[1] as InputStep;
      const inputStub = {
        showQuickPick: sinon
          .stub()
          .resolves({ label: 'Project', detail: 'p-id' }),
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
    sinon.assert.calledWith(instanceManagerStub.setProjectId, 'p-id');
    sinon.assert.calledOnce(instanceManagerStub.setShouldRefresh);
    sinon.assert.notCalled(executeCommandStub);
  });

  it('renders instances or opens external URL when empty', async () => {
    getOrCreateSessionStub.resolves({ accessToken: 'token' });

    const runTestScenario = async (
      instances: WorkbenchJupyterServer[],
      userSelectionLabel: string,
    ) => {
      instanceManagerStub.getWorkbenchServers.resolves(instances);

      const fakeQuickPick = {
        items: [] as vscode.QuickPickItem[],
        busy: false,
      };

      multiStepRunStub.callsFake(
        async (_vs: typeof vscode, inputStep: InputStep) => {
          const inputStub = {
            showQuickPick: sinon.stub(),
          };

          // Step 1: pickProject
          inputStub.showQuickPick
            .onFirstCall()
            .resolves({ label: 'Project', detail: 'p-id' });
          const pickInstanceStep = await inputStep(
            inputStub as unknown as MultiStepInput,
          );

          // Step 2: pickInstance
          inputStub.showQuickPick
            .onSecondCall()
            .callsFake(async (opts: QuickPickOptions<vscode.QuickPickItem>) => {
              if (opts.onDidCreate) {
                void opts.onDidCreate(
                  fakeQuickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>,
                );
                // Yield to allow onDidCreate to populate the instances array
                await new Promise((resolve) => setTimeout(resolve, 10));
              }
              return { label: userSelectionLabel };
            });

          if (pickInstanceStep) {
            await pickInstanceStep(inputStub as unknown as MultiStepInput);
          }
        },
      );

      const result = await selectProjectCommand(
        vsCodeStub,
        resourceManagerStub,
        instanceManagerStub,
      );

      return { result, items: fakeQuickPick.items };
    };

    // Case 1: Instances available
    const { result: instancesResult, items: instancesItems } =
      await runTestScenario(
        [
          {
            label: 'Instance 1',
            id: 'i-1',
          } as unknown as WorkbenchJupyterServer,
        ],
        'Instance 1',
      );
    expect(instancesItems).to.deep.equal([{ label: 'Instance 1' }]);
    expect(instancesResult).to.deep.equal({ label: 'Instance 1', id: 'i-1' });

    // Case 2: No instances -> Redirect
    const openExternalStub = vsCodeStub.env.openExternal as sinon.SinonStub;
    const { result: noInstancesResult, items: noInstancesItems } =
      await runTestScenario([], 'No active instance, please enable them');
    expect(noInstancesItems[0].label).to.equal(
      'No active instance, please enable them',
    );
    expect(noInstancesResult).to.be.undefined;

    sinon.assert.calledOnce(openExternalStub);
    sinon.assert.calledWith(
      openExternalStub,
      sinon.match((uri: vscode.Uri) =>
        uri.toString().includes('vertex-ai/workbench/instances?project=p-id'),
      ),
    );
  });
});
