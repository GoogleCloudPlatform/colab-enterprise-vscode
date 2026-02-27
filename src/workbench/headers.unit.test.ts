/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { getExtensionVersion } from './headers';

describe('headers', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getExtensionVersion', () => {
    it('returns version from vscode.extensions', () => {
      (vscode.extensions.getExtension as sinon.SinonStub).returns({
        packageJSON: {
          publisher: 'google',
          name: 'workbench',
          version: '3.2.1',
        },
      } as unknown as vscode.Extension<unknown>);

      expect(getExtensionVersion()).to.equal('3.2.1');
    });

    it('returns fallback version if vscode.extensions has no version', () => {
      (vscode.extensions.getExtension as sinon.SinonStub).returns({
        packageJSON: {},
      } as unknown as vscode.Extension<unknown>);

      expect(getExtensionVersion()).to.equal('0.0.0');
    });

    it('returns fallback version if vscode.extensions.getExtension returns undefined', () => {
      (vscode.extensions.getExtension as sinon.SinonStub).returns(undefined);

      expect(getExtensionVersion()).to.equal('0.0.0');
    });
  });
});
