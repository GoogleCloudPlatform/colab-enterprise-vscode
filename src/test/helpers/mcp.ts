/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';

/**
 * Mirrors {@link vscode.McpHttpServerDefinition}, a class the extension host
 * supplies, for use in tests.
 */
export class TestMcpHttpServerDefinition
  implements vscode.McpHttpServerDefinition
{
  constructor(
    readonly label: string,
    public uri: vscode.Uri,
    public headers: Record<string, string> = {},
    public version?: string,
  ) {}
}
