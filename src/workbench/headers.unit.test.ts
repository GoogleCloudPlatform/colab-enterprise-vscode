/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import * as sinon from 'sinon';
import vscode from 'vscode';
import { getWorkbenchClientHeaderWithVersion } from './headers';

describe('headers', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getWorkbenchClientHeaderWithVersion', () => {
    it('returns the correct header', () => {
      (vscode.extensions.getExtension as sinon.SinonStub).returns({
        packageJSON: {
          publisher: 'google',
          name: 'workbench',
          version: '1.2.3',
        },
      } as vscode.Extension<undefined>);

      const header = getWorkbenchClientHeaderWithVersion();
      expect(header.key).to.equal('X-Goog-Api-Client');
      expect(header.value).to.equal('vertex-ai-workbench-vscode-ext/1.2.3');
    });
  });
});
