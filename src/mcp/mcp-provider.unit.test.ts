/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { expect } from 'chai';
import { OAuth2Client } from 'google-auth-library';
import sinon from 'sinon';
import vscode from 'vscode';
import { AuthChangeEvent, GoogleAuthProvider } from '../auth/auth-provider';
import { log } from '../common/logging/logger';
import { CONFIG } from '../config';
import { ConnectionRefresher } from '../jupyter/connection-refresher';
import { TestEventEmitter } from '../test/helpers/events';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { CONTROL_PLANE_MCP_ID, ControlPlaneMcpProvider } from './mcp-provider';

const VERSION = '1.2.3';
const HOUR_MS = 60 * 60 * 1000;
const REFRESH_BEFORE_EXPIRY_MS = 5 * 60 * 1000;

describe('ControlPlaneMcpProvider', () => {
  let clock: sinon.SinonFakeTimers;
  let vsStub: VsCodeStub;
  let authChange: TestEventEmitter<AuthChangeEvent>;
  let authClient: OAuth2Client;
  let refresher: ConnectionRefresher;
  let getOrCreateSessionStub: sinon.SinonStub;
  let provider: ControlPlaneMcpProvider;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    vsStub = newVsCodeStub();
    (vscode.extensions.getExtension as sinon.SinonStub).returns({
      packageJSON: {
        publisher: 'googlecloudtools',
        name: 'workbench-notebooks',
        version: VERSION,
      },
    });
    sinon.stub(log, 'info');
    authChange = new TestEventEmitter<AuthChangeEvent>();
    authClient = { credentials: {} } as unknown as OAuth2Client;
    getOrCreateSessionStub = sinon.stub(
      GoogleAuthProvider,
      'getOrCreateSession',
    );
    let tokenCount = 0;
    getOrCreateSessionStub.callsFake(() => {
      authClient.credentials.expiry_date = Date.now() + HOUR_MS;
      tokenCount++;
      return Promise.resolve({ accessToken: `token-${tokenCount.toString()}` });
    });
    refresher = new ConnectionRefresher(vsStub.asVsCode(), authClient);
    provider = new ControlPlaneMcpProvider(
      vsStub.asVsCode(),
      authChange.event,
      refresher,
    );
  });

  afterEach(() => {
    provider.dispose();
    refresher.dispose();
    clock.restore();
    sinon.restore();
  });

  it('registers under the id contributed in package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(join(__dirname, '../../../package.json'), 'utf8'),
    ) as { contributes: { mcpServerDefinitionProviders: { id: string }[] } };

    sinon.assert.calledOnceWithExactly(
      vsStub.lm.registerMcpServerDefinitionProvider,
      CONTROL_PLANE_MCP_ID,
      provider,
    );
    expect(
      packageJson.contributes.mcpServerDefinitionProviders.map((p) => p.id),
    ).to.include(CONTROL_PLANE_MCP_ID);
  });

  it('provides the control plane server without a token', () => {
    const servers = provider.provideMcpServerDefinitions();

    expect(servers).to.have.lengthOf(1);
    const [server] = servers;
    expect(server.uri.toString()).to.equal(CONFIG.ControlPlaneMcpUrl);
    expect(server.version).to.equal('0');
    expect(server.headers).to.deep.equal({
      'X-Goog-Api-Client': `vertex-ai-workbench-vscode-ext/${VERSION}`,
    });
    sinon.assert.notCalled(getOrCreateSessionStub);
  });

  it('adds the session access token on resolve', async () => {
    const [server] = provider.provideMcpServerDefinitions();

    const resolved = await provider.resolveMcpServerDefinition(server);

    expect(resolved.headers).to.deep.equal({
      ...server.headers,
      Authorization: 'Bearer token-1',
    });
    expect(resolved.uri).to.equal(server.uri);
    expect(server.headers).to.not.have.property('Authorization');
  });

  it('restarts the server with a new version before the token expires', async () => {
    const listener = sinon.stub();
    provider.onDidChangeMcpServerDefinitions(listener);
    await provider.resolveMcpServerDefinition(
      provider.provideMcpServerDefinitions()[0],
    );

    await clock.tickAsync(HOUR_MS - REFRESH_BEFORE_EXPIRY_MS - 1);
    sinon.assert.notCalled(listener);
    await clock.tickAsync(1);

    sinon.assert.calledOnce(listener);
    expect(provider.provideMcpServerDefinitions()[0].version).to.equal('1');
  });

  it('restarts the server with a new version when the session changes', () => {
    const listener = sinon.stub();
    provider.onDidChangeMcpServerDefinitions(listener);

    authChange.fire({
      added: [],
      removed: [],
      changed: [],
      hasValidSession: false,
    });

    sinon.assert.calledOnce(listener);
    expect(provider.provideMcpServerDefinitions()[0].version).to.equal('1');
  });

  it('unregisters on dispose', () => {
    const registration =
      vsStub.lm.registerMcpServerDefinitionProvider.firstCall.returnValue;

    provider.dispose();

    sinon.assert.calledOnce(registration.dispose as sinon.SinonStub);
  });
});
