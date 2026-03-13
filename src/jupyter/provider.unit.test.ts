/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Jupyter,
  JupyterServerCollection,
  JupyterServerProvider,
} from '@vscode/jupyter-extension';
import { expect } from 'chai';
import sinon from 'sinon';
import { SinonStubbedInstance } from 'sinon';
import vscode from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { WORKBENCH_COMMAND } from '../workbench/constants';
import { ProjectsClient } from '../workbench/projects-client';
import { WorkbenchJupyterServerProvider } from './provider';
import {
  WorkbenchInstanceManager,
  WorkbenchJupyterServer,
} from './workbench-instance-manager';

describe('WorkbenchJupyterServerProvider', () => {
  let vsCodeStub: VsCodeStub;
  let cancellationToken: vscode.CancellationToken;
  let jupyterStub: SinonStubbedInstance<
    Pick<Jupyter, 'createJupyterServerCollection'>
  >;
  let serverCollectionStub: SinonStubbedInstance<JupyterServerCollection>;
  let serverCollectionDisposeStub: sinon.SinonStub<[], void>;

  let projectsClientStub: SinonStubbedInstance<ProjectsClient>;
  let instanceManagerStub: SinonStubbedInstance<WorkbenchInstanceManager>;
  let serverProvider: WorkbenchJupyterServerProvider;

  const MOCK_SERVER: WorkbenchJupyterServer = {
    id: 'server-1',
    label: 'Server 1',
    name: 'server-1',
    projectId: 'project-1',
    proxyUri: 'http://server-1.com',
    connectionInformation: {
      baseUrl: undefined as unknown as vscode.Uri,
      headers: {
        Authorization: 'Bearer token',
        Cookie: 'cookie',
        'X-XSRFToken': 'token',
        Origin: 'http://server-1.com',
      },
    },
  };

  beforeEach(() => {
    vsCodeStub = newVsCodeStub();
    cancellationToken = new vsCodeStub.CancellationTokenSource().token;
    serverCollectionDisposeStub = sinon.stub();
    jupyterStub = {
      createJupyterServerCollection: sinon.stub(),
    };
    jupyterStub.createJupyterServerCollection.callsFake(
      (
        id: string,
        label: string,
        serverProvider: JupyterServerProvider,
      ): JupyterServerCollection => {
        serverCollectionStub = {
          id,
          label,
          serverProvider,
          dispose: serverCollectionDisposeStub,
          commandProvider: undefined, // Added for new test logic
        } as unknown as SinonStubbedInstance<JupyterServerCollection>;
        return serverCollectionStub;
      },
    );

    projectsClientStub = sinon.createStubInstance(ProjectsClient);
    projectsClientStub.getProjects.resolves([]);
    instanceManagerStub = sinon.createStubInstance(WorkbenchInstanceManager);

    serverProvider = new WorkbenchJupyterServerProvider(
      vsCodeStub.asVsCode(),
      projectsClientStub,
      instanceManagerStub,
      jupyterStub as unknown as Jupyter,
    );

    vsCodeStub.window.withProgress.callsFake(async (_options, task) => {
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      return task({ report: () => {} }, cancellationToken);
    });
  });

  afterEach(() => {
    sinon.restore();
    serverProvider.dispose(); // Ensure provider is disposed after each test
  });

  describe('lifecycle', () => {
    it('registers the "Workbench" Jupyter server collection', () => {
      sinon.assert.calledOnceWithExactly(
        jupyterStub.createJupyterServerCollection,
        'google-cloud',
        'Google Cloud',
        serverProvider,
      );
    });

    it('disposes the server collection', () => {
      serverProvider.dispose();
      sinon.assert.calledOnce(serverCollectionDisposeStub);
    });
  });

  describe('provideJupyterServers', () => {
    it('returns servers from instance manager', async () => {
      const expectedServers: WorkbenchJupyterServer[] = [
        { ...MOCK_SERVER, id: 'server1' },
        { ...MOCK_SERVER, id: 'server2' },
      ];
      instanceManagerStub.getWorkbenchServers.resolves(expectedServers);

      const result =
        await serverProvider.provideJupyterServers(cancellationToken);

      expect(result).to.deep.equal(expectedServers);
    });

    it('handles empty lists', async () => {
      instanceManagerStub.getWorkbenchServers.resolves([]);
      const result =
        await serverProvider.provideJupyterServers(cancellationToken);
      expect(result).to.deep.equal([]);
    });
  });

  describe('resolveJupyterServer', () => {
    it('delegates to instance manager', async () => {
      // Create a plain object that mimics WorkbenchJupyterServer for the
      // argument. The implementation expects WorkbenchJupyterServer structure.
      const serverArg: WorkbenchJupyterServer = {
        id: 's1',
        projectId: 'p1',
        name: 's1',
        label: 's1',
        proxyUri: '',
      };

      const expected: WorkbenchJupyterServer = {
        ...serverArg,
        connectionInformation: {
          baseUrl: {} as unknown as vscode.Uri,
          headers: {
            Cookie: 'mock-cookie',
            'X-XSRFToken': 'mock-token',
            Origin: 'mock-origin',
          },
        },
      };

      instanceManagerStub.refreshConnection.resolves(expected);

      const result = await serverProvider.resolveJupyterServer(
        serverArg,
        cancellationToken,
      );

      expect(result).to.equal(expected);
      sinon.assert.calledWith(instanceManagerStub.refreshConnection, serverArg);
    });
  });

  describe('provideCommands', () => {
    it('returns WORKBENCH_COMMAND', () => {
      const commands = serverProvider.provideCommands(
        undefined,
        cancellationToken,
      );
      expect(commands).to.have.lengthOf(1);
      expect(commands[0]).to.deep.equal(WORKBENCH_COMMAND);
      sinon.assert.calledWith(instanceManagerStub.setShouldRefresh);
    });
  });

  describe('handleCommand', () => {
    it('handles WORKBENCH_COMMAND without error', async () => {
      const getOrCreateSessionStub = sinon.stub(
        GoogleAuthProvider,
        'getOrCreateSession',
      );
      getOrCreateSessionStub.resolves({
        id: 'id',
        accessToken: 'token',
        account: { id: 'user', label: 'User' },
        scopes: [],
      });

      const result = serverProvider.handleCommand(
        WORKBENCH_COMMAND,
        cancellationToken,
      );

      expect(result).to.be.instanceOf(Promise);
      const value = await result;
      expect(value).to.be.undefined;
    });

    it('throws error for unknown commands', async () => {
      const command = { id: 'other', label: 'Other' };
      try {
        await serverProvider.handleCommand(command, cancellationToken);
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect((err as Error).message).to.match(/Unknown command/);
      }
    });

    it('closes menu when auth flow is cancelled or error happened', async () => {
      const getOrCreateSessionStub = sinon.stub(
        GoogleAuthProvider,
        'getOrCreateSession',
      );
      const error = new Error('Login cancelled');
      error.name = 'LoginCancellation';
      getOrCreateSessionStub.rejects(error);

      try {
        await serverProvider.handleCommand(
          WORKBENCH_COMMAND,
          cancellationToken,
        );
        expect.fail('Should have thrown');
      } catch (err: unknown) {
        expect(err).to.equal(error);
        sinon.assert.calledWith(
          vsCodeStub.commands.executeCommand,
          'workbench.action.closeQuickOpen',
        );
      }
    });

    it('ensures GoogleAuthProvider.getOrCreateSession is called', async () => {
      const getOrCreateSessionStub = sinon.stub(
        GoogleAuthProvider,
        'getOrCreateSession',
      );
      getOrCreateSessionStub.resolves({
        id: 'id',
        accessToken: 'token',
        account: { id: 'user', label: 'User' },
        scopes: [],
      });

      await serverProvider.handleCommand(WORKBENCH_COMMAND, cancellationToken);
      sinon.assert.calledOnceWithExactly(
        getOrCreateSessionStub,
        vsCodeStub.asVsCode(),
      );
    });
  });
});
