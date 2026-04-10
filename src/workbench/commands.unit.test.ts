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
import { buildQuickPickStub, QuickPickStub } from '../test/helpers/quick-input';
import { newVsCodeStub } from '../test/helpers/vscode';
import { NO_ACTIVE_INSTANCE_LABEL } from './constants';
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

  describe('instance selection flow', () => {
    let quickPicks: QuickPickStub[] = [];

    beforeEach(() => {
      multiStepRunStub.restore();
      getOrCreateSessionStub.resolves({ accessToken: 'token' });

      quickPicks = [];
      const createQuickPickStub = vsCodeStub.window
        .createQuickPick as sinon.SinonStub;
      createQuickPickStub.callsFake(() => {
        const qp = buildQuickPickStub();
        quickPicks.push(qp as unknown as QuickPickStub);
        return qp;
      });
    });

    it('renders instances when project has them', async () => {
      instanceManagerStub.getWorkbenchServers.resolves([
        { label: 'Instance 1', id: 'i-1' } as unknown as WorkbenchJupyterServer,
      ]);

      const commandPromise = selectProjectCommand(
        vsCodeStub,
        resourceManagerStub,
        instanceManagerStub,
      );

      await new Promise((resolve) => setImmediate(resolve));

      expect(quickPicks.length).to.equal(1);
      const qp = quickPicks[0];
      expect(qp.ignoreFocusOut).to.be.true;

      qp.selectedItems = [{ label: 'Project', detail: 'p-id' }];
      qp.onDidAccept.getCall(0).args[0]();

      await new Promise((resolve) => setImmediate(resolve));

      expect(quickPicks.length).to.equal(2);
      const instanceQp = quickPicks[1];
      expect(instanceQp.ignoreFocusOut).to.be.true;

      expect(instanceQp.items).to.deep.equal([{ label: 'Instance 1' }]);

      instanceQp.selectedItems = [{ label: 'Instance 1', description: 'i-1' }];
      instanceQp.onDidAccept.getCall(0).args[0]();

      const result = await commandPromise;
      expect(result).to.deep.equal({ label: 'Instance 1', id: 'i-1' });
    });

    it('opens external URL when project has no instances', async () => {
      instanceManagerStub.getWorkbenchServers.resolves([]);

      const commandPromise = selectProjectCommand(
        vsCodeStub,
        resourceManagerStub,
        instanceManagerStub,
      );

      await new Promise((resolve) => setImmediate(resolve));
      expect(quickPicks.length).to.equal(1);
      const qp = quickPicks[0];

      qp.selectedItems = [{ label: 'Project', detail: 'p-id' }];
      qp.onDidAccept.getCall(0).args[0]();

      await new Promise((resolve) => setImmediate(resolve));
      expect(quickPicks.length).to.equal(2);
      const instanceQp = quickPicks[1];

      expect(instanceQp.items[0].label).to.equal(NO_ACTIVE_INSTANCE_LABEL);

      instanceQp.selectedItems = [
        {
          label: NO_ACTIVE_INSTANCE_LABEL,
        },
      ];
      instanceQp.onDidAccept.getCall(0).args[0]();

      const result = await commandPromise;
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
});
