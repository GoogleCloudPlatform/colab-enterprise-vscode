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

  it('fetches instances and returns selected server', async () => {
    getOrCreateSessionStub.resolves({ accessToken: 'token' });
    const instances: WorkbenchJupyterServer[] = [
      { label: 'Instance 1', id: 'i-1' } as unknown as WorkbenchJupyterServer,
    ];
    instanceManagerStub.getWorkbenchServers.resolves(instances);

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

        expect(pickInstanceStep).to.be.a('function');

        // Step 2: pickInstance
        let capturedQuickPick:
          | {
              busy: boolean;
              _items: vscode.QuickPickItem[];
              items: readonly vscode.QuickPickItem[];
            }
          | undefined;
        inputStub.showQuickPick
          .onSecondCall()
          .callsFake(async (opts: QuickPickOptions<vscode.QuickPickItem>) => {
            if (opts.onDidCreate) {
              capturedQuickPick = {
                busy: false,
                _items: [],
                set items(items: readonly vscode.QuickPickItem[]) {
                  this._items = items as vscode.QuickPickItem[];
                },
                get items() {
                  return this._items;
                },
              };
              opts.onDidCreate(
                capturedQuickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>,
              );
              // Wait for async instances fetch
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            return { label: 'Instance 1' };
          });

        if (pickInstanceStep) {
          await pickInstanceStep(inputStub as unknown as MultiStepInput);
        }

        return undefined;
      },
    );

    const result = await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(instanceManagerStub.setProjectId, 'p-id');
    sinon.assert.calledOnce(instanceManagerStub.setShouldRefresh);
    sinon.assert.calledOnce(instanceManagerStub.getWorkbenchServers);
    expect(result).to.deep.equal({ label: 'Instance 1', id: 'i-1' });
  });

  it('handles empty instance list and opens external URL', async () => {
    getOrCreateSessionStub.resolves({ accessToken: 'token' });
    instanceManagerStub.getWorkbenchServers.resolves([]);

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

        expect(pickInstanceStep).to.be.a('function');

        // Step 2: pickInstance
        let capturedQuickPick:
          | {
              busy: boolean;
              _items: vscode.QuickPickItem[];
              items: readonly vscode.QuickPickItem[];
            }
          | undefined;
        inputStub.showQuickPick
          .onSecondCall()
          .callsFake(async (opts: QuickPickOptions<vscode.QuickPickItem>) => {
            if (opts.onDidCreate) {
              capturedQuickPick = {
                busy: false,
                _items: [],
                set items(items: readonly vscode.QuickPickItem[]) {
                  this._items = items as vscode.QuickPickItem[];
                },
                get items() {
                  return this._items;
                },
              };
              opts.onDidCreate(
                capturedQuickPick as unknown as vscode.QuickPick<vscode.QuickPickItem>,
              );
              await new Promise((resolve) => setTimeout(resolve, 10));
            }
            return { label: 'No active instance, please enable them' };
          });

        if (pickInstanceStep) {
          await pickInstanceStep(inputStub as unknown as MultiStepInput);
        }

        return undefined;
      },
    );

    const result = await selectProjectCommand(
      vsCodeStub,
      resourceManagerStub,
      instanceManagerStub,
    );

    sinon.assert.calledOnce(multiStepRunStub);
    sinon.assert.calledWith(instanceManagerStub.setProjectId, 'p-id');
    sinon.assert.calledOnce(instanceManagerStub.setShouldRefresh);
    sinon.assert.calledOnce(instanceManagerStub.getWorkbenchServers);
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
