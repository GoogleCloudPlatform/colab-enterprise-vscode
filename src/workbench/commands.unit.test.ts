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
import { MultiStepInput } from '../common/multi-step-quickpick';
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
    if (multiStepRunStub) {
      multiStepRunStub.restore();
    }
    getOrCreateSessionStub.resolves({ accessToken: 'token' });

    let quickPicks: any[] = [];
    const createQuickPickStub = vsCodeStub.window
      .createQuickPick as sinon.SinonStub;
    createQuickPickStub.callsFake(() => {
      const { buildQuickPickStub } = require('../test/helpers/quick-input') as typeof import('../test/helpers/quick-input');
      const qp = buildQuickPickStub();
      quickPicks.push(qp);
      return qp;
    });

    instanceManagerStub.getWorkbenchServers.resolves([
      { label: 'Instance 1', id: 'i-1' } as unknown as WorkbenchJupyterServer,
    ]);

    // Start the command but do NOT await it immediately, let it run in background!
    let commandPromise = selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    // Give the command time to hit the first quickPick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(quickPicks.length).to.equal(1);
    let qp = quickPicks[0];

    // Simulate user selecting a project
    qp.selectedItems = [{ label: 'Project', detail: 'p-id' }];
    qp.onDidAccept.getCall(0).args[0]();

    // Give the command time to process Project selection and hit the Instance QuickPick
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(quickPicks.length).to.equal(2);
    qp = quickPicks[1];

    // Assert items were populated correctly from the mock data (withError has had time to resolve)
    expect(qp.items).to.deep.equal([{ label: 'Instance 1' }]);

    // Select the instance & accept
    qp.selectedItems = [{ label: 'Instance 1', description: 'i-1' }];
    qp.onDidAccept.getCall(0).args[0]();

    let result = await commandPromise;
    expect(result).to.deep.equal({ label: 'Instance 1', id: 'i-1' });

    // ==========================================
    // Case 2: No instances -> Redirect
    // ==========================================
    quickPicks = [];
    instanceManagerStub.getWorkbenchServers.resolves([]);

    commandPromise = selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    // Wait for Project QuickPick
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(quickPicks.length).to.equal(1);
    qp = quickPicks[0];

    // Select project & accept
    qp.selectedItems = [{ label: 'Project', detail: 'p-id' }];
    qp.onDidAccept.getCall(0).args[0]();

    // Wait for Instance QuickPick
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(quickPicks.length).to.equal(2);
    qp = quickPicks[1];

    expect(qp.items[0].label).to.equal(
      'No active instance, please enable them',
    );

    // Select redirect message & accept
    qp.selectedItems = [{ label: 'No active instance, please enable them' }];
    qp.onDidAccept.getCall(0).args[0]();

    result = await commandPromise;
    expect(result).to.be.undefined;

    const openExternalStub = vsCodeStub.env.openExternal as sinon.SinonStub;
    sinon.assert.calledOnce(openExternalStub);
    sinon.assert.calledWith(
      openExternalStub,
      sinon.match((uri: vscode.Uri) =>
        uri.toString().includes('vertex-ai/workbench/instances?project=p-id'),
      ),
    );
  });
});
