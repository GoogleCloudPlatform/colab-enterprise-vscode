/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import { OAuth2Client } from 'google-auth-library';
import sinon from 'sinon';
import vscode from 'vscode';
import { newVsCodeStub, VsCodeStub } from '../../test/helpers/vscode';
import { getOAuth2Flows, OAuth2Flow } from './flows';

describe('getOAuth2Flows', () => {
  let vs: VsCodeStub;

  beforeEach(() => {
    vs = newVsCodeStub();
  });

  afterEach(() => {
    sinon.restore();
  });

  function getOAuth2FlowsFor(uiKind: vscode.UIKind): OAuth2Flow[] {
    vs.env.uiKind = uiKind;
    return getOAuth2Flows(
      vs.asVsCode(),
      sinon.createStubInstance(OAuth2Client),
    );
  }

  it('returns the local server flow when running on desktop', () => {
    const flows = getOAuth2FlowsFor(vs.UIKind.Desktop);

    expect(flows).to.have.lengthOf(1);
    expect(flows[0].constructor.name).to.equal('LocalServerFlow');
  });
});
