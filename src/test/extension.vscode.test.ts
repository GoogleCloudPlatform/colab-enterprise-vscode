/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import vscode from 'vscode';
import { getExtensionVersion } from '../workbench/headers';

describe('Extension', () => {
  it('should be present', () => {
    assert.ok(vscode.extensions.getExtension('google.workbench'));
  });

  it('should activate', async () => {
    const extension = vscode.extensions.getExtension('google.workbench');

    await extension?.activate();

    assert.strictEqual(extension?.isActive, true);
  });

  it('should read the correct extension version', () => {
    const version = getExtensionVersion();
    // not the 0.0.0 fallback
    assert.notStrictEqual(version, '0.0.0');
  });
});
