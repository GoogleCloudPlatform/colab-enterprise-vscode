/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { OAuth2Client } from 'google-auth-library';
import sinon from 'sinon';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { getOAuth2Flow } from './flows';

describe('getOAuth2Flow', () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns the local server flow', () => {
    const flow = getOAuth2Flow(
      vs.asVsCode(),
      sinon.createStubInstance(OAuth2Client),
    );

    expect(flow.constructor.name).to.equal('LocalServerFlow');
  });
});
