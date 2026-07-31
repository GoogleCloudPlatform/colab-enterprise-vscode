/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import '../test/helpers/vscode';

import { expect } from 'chai';
import { OAuth2Client } from 'google-auth-library';
import sinon from 'sinon';
import type { AuthenticationSession } from 'vscode';
import { GoogleAuthProvider } from '../auth/auth-provider';
import { newVsCodeStub } from '../test/helpers/vscode';
import { AUTHORIZATION_HEADER } from '../workbench/headers';
import {
  ConnectionRefresher,
  RefreshableConnection,
} from './connection-refresher';

const HOUR_MS = 60 * 60 * 1000;
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const RETRY_BUFFER_MS = 30 * 1000;

const authOf = (connection: RefreshableConnection): string =>
  connection.headers[AUTHORIZATION_HEADER.key];

describe('ConnectionRefresher', () => {
  let clock: sinon.SinonFakeTimers;
  let getOrCreateSessionStub: sinon.SinonStub;
  let authClient: OAuth2Client;
  let refresher: ConnectionRefresher;

  const sessionWith = (accessToken: string): AuthenticationSession => ({
    id: 'session-id',
    accessToken,
    account: { id: 'account-id', label: 'Account' },
    scopes: [],
  });

  /**
   * Makes `getOrCreateSession` resolve with the given token and refresh the
   * OAuth client's reported expiry to `lifetimeMs` from now.
   */
  const resolvesToken =
    (token: string, lifetimeMs = HOUR_MS) =>
    (): Promise<AuthenticationSession> => {
      authClient.credentials.expiry_date = Date.now() + lifetimeMs;
      return Promise.resolve(sessionWith(token));
    };

  const newConnection = (origin = 'https://server'): RefreshableConnection => ({
    token: '',
    tokenExpiry: new Date(0),
    headers: {
      [AUTHORIZATION_HEADER.key]: '',
      Cookie: '_xsrf=XSRF',
      'X-XSRFToken': 'XSRF',
      Origin: origin,
    },
  });

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    authClient = { credentials: {} } as unknown as OAuth2Client;
    getOrCreateSessionStub = sinon.stub(
      GoogleAuthProvider,
      'getOrCreateSession',
    );
    refresher = new ConnectionRefresher(newVsCodeStub().asVsCode(), authClient);
  });

  afterEach(() => {
    refresher.dispose();
    clock.restore();
    sinon.restore();
  });

  it('stamps token, expiry, and Authorization header on watch', async () => {
    getOrCreateSessionStub.callsFake(resolvesToken('token-1'));
    const connection = newConnection();

    await refresher.refresh('server-a', connection);

    expect(connection.token).to.equal('token-1');
    expect(authOf(connection)).to.equal('Bearer token-1');
    expect(connection.tokenExpiry.getTime()).to.equal(Date.now() + HOUR_MS);
    sinon.assert.calledOnce(getOrCreateSessionStub);
  });

  it('refreshes ahead of expiry and reschedules from the new expiry', async () => {
    getOrCreateSessionStub.onCall(0).callsFake(resolvesToken('token-1'));
    getOrCreateSessionStub.onCall(1).callsFake(resolvesToken('token-2'));
    getOrCreateSessionStub.onCall(2).callsFake(resolvesToken('token-3'));
    const connection = newConnection();

    await refresher.refresh('server-a', connection);
    expect(connection.token).to.equal('token-1');

    // Nothing should happen until the refresh buffer before expiry.
    await clock.tickAsync(HOUR_MS - REFRESH_BUFFER_MS - 1);
    expect(connection.token).to.equal('token-1');

    // Crossing the refresh point triggers a refresh, updating in place.
    await clock.tickAsync(1);
    expect(connection.token).to.equal('token-2');
    expect(authOf(connection)).to.equal('Bearer token-2');

    // The next refresh is scheduled from the new token's expiry.
    await clock.tickAsync(HOUR_MS - REFRESH_BUFFER_MS);
    expect(connection.token).to.equal('token-3');
  });

  it('refreshes each watched server independently', async () => {
    let currentToken = 'initial';
    getOrCreateSessionStub.callsFake((): Promise<AuthenticationSession> => {
      authClient.credentials.expiry_date = Date.now() + HOUR_MS;
      return Promise.resolve(sessionWith(currentToken));
    });
    const connectionA = newConnection('https://a');
    const connectionB = newConnection('https://b');

    await refresher.refresh('server-a', connectionA);
    await refresher.refresh('server-b', connectionB);
    expect(connectionA.token).to.equal('initial');
    expect(connectionB.token).to.equal('initial');

    currentToken = 'rotated';
    await clock.tickAsync(HOUR_MS - REFRESH_BUFFER_MS);

    expect(connectionA.token).to.equal('rotated');
    expect(connectionB.token).to.equal('rotated');
    expect(authOf(connectionA)).to.equal('Bearer rotated');
    expect(authOf(connectionB)).to.equal('Bearer rotated');
  });

  it('assumes a default lifetime when the client reports no expiry', async () => {
    getOrCreateSessionStub
      .onCall(0)
      .callsFake((): Promise<AuthenticationSession> => {
        authClient.credentials.expiry_date = undefined;
        return Promise.resolve(sessionWith('token-1'));
      });
    getOrCreateSessionStub.onCall(1).callsFake(resolvesToken('token-2'));
    const connection = newConnection();

    await refresher.refresh('server-a', connection);
    expect(connection.token).to.equal('token-1');

    // With no reported expiry it assumes ~1h and refreshes the buffer before.
    await clock.tickAsync(HOUR_MS - REFRESH_BUFFER_MS);
    expect(connection.token).to.equal('token-2');
  });

  it('retries after a failure while the token is still valid', async () => {
    getOrCreateSessionStub.onCall(0).callsFake(resolvesToken('token-1'));
    getOrCreateSessionStub.onCall(1).rejects(new Error('network down'));
    getOrCreateSessionStub.onCall(2).callsFake(resolvesToken('token-2'));
    const connection = newConnection();

    await refresher.refresh('server-a', connection);

    // First scheduled refresh fails.
    await clock.tickAsync(HOUR_MS - REFRESH_BUFFER_MS);
    expect(connection.token).to.equal('token-1'); // retained

    // A retry is scheduled shortly after and succeeds.
    await clock.tickAsync(RETRY_BUFFER_MS);
    expect(connection.token).to.equal('token-2');
  });

  it('gives up retrying when the token is about to expire', async () => {
    // Token expires so soon that a retry could not complete before expiry.
    getOrCreateSessionStub
      .onCall(0)
      .callsFake(resolvesToken('token-1', 10 * 1000));
    getOrCreateSessionStub.onCall(1).rejects(new Error('network down'));
    const connection = newConnection();

    await refresher.refresh('server-a', connection);

    // The scheduled refresh (clamped to the minimum delay) fails.
    await clock.tickAsync(RETRY_BUFFER_MS + 1000);
    // No retry scheduled: only watch + the single failed attempt.
    sinon.assert.calledTwice(getOrCreateSessionStub);
    expect(connection.token).to.equal('token-1');
  });

  it('stops refreshing after dispose', async () => {
    getOrCreateSessionStub.callsFake(resolvesToken('token-1'));

    await refresher.refresh('server-a', newConnection());
    sinon.assert.calledOnce(getOrCreateSessionStub);

    refresher.dispose();

    await clock.tickAsync(HOUR_MS * 3);
    sinon.assert.calledOnce(getOrCreateSessionStub);
  });

  it('throws if watched after dispose', async () => {
    refresher.dispose();
    await expect(
      refresher.refresh('server-a', newConnection()),
    ).to.be.rejectedWith(
      'Cannot use ConnectionRefresher after it has been disposed',
    );
  });
});
