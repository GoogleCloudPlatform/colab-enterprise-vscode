/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { gaxios, OAuth2Client } from 'google-auth-library';
import { GetTokenResponse } from 'google-auth-library/build/src/auth/oauth2client';
import sinon from 'sinon';
import vscode from 'vscode';
import { newVsCodeStub, VsCodeStub } from '../test/helpers/vscode';
import { OAuth2Flow } from './flows/flows';
import { login, createCertificateErrorHandler } from './login';
import { RefreshableAuthenticationSession } from './storage';

const CODE = '123';
const REDIRECT = 'http://example.com/redirect';
const SCOPES = ['scope1', 'scope2'];
const ACCESS_TOKEN = '42';
const REFRESH_SESSION: RefreshableAuthenticationSession = {
  id: '1',
  refreshToken: '1//23',
  account: {
    label: 'Foo Bar',
    id: 'foo@example.com',
  },
  scopes: SCOPES,
};

const NOW = Date.now();
const HOUR_MS = 60 * 60 * 1000;
const CREDENTIALS = {
  refresh_token: REFRESH_SESSION.refreshToken,
  access_token: ACCESS_TOKEN,
  expiry_date: NOW + HOUR_MS,
  id_token: 'eh',
  scope: SCOPES.join(' '),
};
const GET_TOKEN_RESPONSE: GetTokenResponse = {
  res: { status: 200 } as gaxios.GaxiosResponse,
  tokens: CREDENTIALS,
};

function buildStubFlow(): sinon.SinonStubbedInstance<OAuth2Flow> {
  return {
    trigger: sinon.stub(),
    dispose: sinon.stub(),
  };
}

describe('login', () => {
  let vs: VsCodeStub;
  let oauth2Client: OAuth2Client;
  const flowCancellationSources: vscode.CancellationTokenSource[] = [];

  beforeEach(() => {
    vs = newVsCodeStub();
    oauth2Client = new OAuth2Client('testClientId', 'testClientSecret');

    vs.window.withProgress
      .withArgs(
        sinon.match({
          location: vs.ProgressLocation.Notification,
          title: sinon.match(/Signing in/),
          cancellable: true,
        }),
        sinon.match.any,
      )
      .callsFake(async (_, task) => {
        // Kick off the flow and capture a reference to the cancellation token
        // source.
        flowCancellationSources.push(new vs.CancellationTokenSource());
        return await task(
          { report: sinon.stub() },
          flowCancellationSources[flowCancellationSources.length - 1].token,
        );
      });
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('with a flow', () => {
    let flow: sinon.SinonStubbedInstance<OAuth2Flow>;
    beforeEach(() => {
      flow = buildStubFlow();
    });

    it('signals cancellation to the flow when the user chooses to cancel', async () => {
      let cancelCalled = false;
      flow.trigger.callsFake(async (options) => {
        return new Promise<never>((_, reject) => {
          options.cancel.onCancellationRequested(() => {
            cancelCalled = true;
            reject(new Error('Cancellation signaled to flow'));
          });
          flowCancellationSources[0].cancel();
        });
      });

      await expect(
        login(vs.asVsCode(), flow, oauth2Client, SCOPES),
      ).to.be.rejectedWith('Cancellation signaled to flow');
      expect(cancelCalled).to.be.true;
    });

    it('throws an error if the flow fails', async () => {
      flow.trigger.rejects(new Error('Flow failed'));

      await expect(
        login(vs.asVsCode(), flow, oauth2Client, SCOPES),
      ).to.be.rejectedWith('Flow failed');
    });

    it('throws an error if a token cannot be obtained', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon.stub(oauth2Client, 'getToken').resolves({
        res: { status: 500, statusText: 'Bad Request' },
        tokens: {},
      } as GetTokenResponse);

      await expect(
        login(vs.asVsCode(), flow, oauth2Client, SCOPES),
      ).to.be.rejectedWith(/get token: Bad Request/);
    });

    it('throws an error if the token is missing credential information', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon.stub(oauth2Client, 'getToken').resolves({
        res: { status: 200 },
        tokens: {},
      } as GetTokenResponse);

      await expect(
        login(vs.asVsCode(), flow, oauth2Client, SCOPES),
      ).to.be.rejectedWith(/credential information/);
    });

    it('returns credentials from a successful login flow', async () => {
      flow.trigger.resolves({
        code: CODE,
        redirectUri: REDIRECT,
      });
      sinon
        .stub(oauth2Client, 'getToken')
        .withArgs({
          code: CODE,
          codeVerifier: sinon.match.string,
          redirect_uri: REDIRECT,
        })
        .resolves(GET_TOKEN_RESPONSE);

      await expect(
        login(vs.asVsCode(), flow, oauth2Client, SCOPES),
      ).to.eventually.deep.equal(CREDENTIALS);
    });
  });
});

describe('createCertificateErrorHandler', () => {
  let vs: VsCodeStub;
  let context: vscode.ExtensionContext;
  let handler: (err: unknown) => Promise<void>;

  beforeEach(() => {
    vs = newVsCodeStub();
    context = {
      globalState: {
        get: sinon.stub(),
        update: sinon.stub(),
      } as unknown as vscode.Memento,
    } as unknown as vscode.ExtensionContext;
    handler = createCertificateErrorHandler(vs.asVsCode(), context);
  });

  it('ignores non-certificate errors', async () => {
    const err = new Error('Some other error');
    await handler(err);
    expect(vs.window.showInformationMessage.called).to.be.false;
  });

  it('prompts user when UNABLE_TO_GET_ISSUER_CERT error occurs', async () => {
    const err = { code: 'UNABLE_TO_GET_ISSUER_CERT' };
    const configStub = {
      get: sinon.stub().returns(false),
      update: sinon.stub().resolves(),
    };
    (
      vs as unknown as { workspace: { getConfiguration: sinon.SinonStub } }
    ).workspace.getConfiguration
      .withArgs('http')
      .returns(configStub as unknown as vscode.WorkspaceConfiguration);
    (context.globalState.get as unknown as sinon.SinonStub)
      .withArgs('dismissSystemCertificatesPrompt', false)
      .returns(false);

    vs.window.showInformationMessage.resolves(
      'Enable' as unknown as vscode.MessageItem,
    );

    await handler(err);

    expect(vs.window.showInformationMessage.calledOnce).to.be.true;
    expect(
      configStub.update.calledWith(
        'systemCertificatesNode',
        true,
        vscode.ConfigurationTarget.Global,
      ),
    ).to.be.true;
  });
});
