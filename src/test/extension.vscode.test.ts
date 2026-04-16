/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as assert from 'assert';
import vscode from 'vscode';

describe('Extension', () => {
  it('should be present', () => {
    assert.ok(
      vscode.extensions.getExtension('googlecloudtools.workbench-notebooks'),
    );
  });

  it('should activate', async () => {
    const extension = vscode.extensions.getExtension(
      'googlecloudtools.workbench-notebooks',
    );

    await extension?.activate();

    assert.strictEqual(extension?.isActive, true);
  });
});
