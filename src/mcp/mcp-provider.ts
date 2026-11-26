/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { AuthChangeEvent } from '../auth/auth-provider';
import { CONFIG } from '../config';
import {
  ConnectionRefresher,
  RefreshableConnection,
} from '../jupyter/connection-refresher';
import { getWorkbenchClientHeaderWithVersion } from '../workbench/headers';

/**
 * The id this provider is registered under. Must match an entry of
 * `contributes.mcpServerDefinitionProviders` in package.json.
 */
export const CONTROL_PLANE_MCP_ID = 'control-plane-mcp';

/**
 * Contributes the Workbench API (control plane) MCP server to VS Code's chat
 * agent, authenticated with the extension's Google Cloud Platform session.
 */
export class ControlPlaneMcpProvider
  implements
    vscode.McpServerDefinitionProvider<vscode.McpHttpServerDefinition>,
    vscode.Disposable
{
  readonly onDidChangeMcpServerDefinitions: vscode.Event<void>;
  private readonly emitter: vscode.EventEmitter<void>;
  private readonly authListener: vscode.Disposable;
  private readonly registration: vscode.Disposable;
  // Changing the server version makes VS Code restart the server, which
  // refreshes the token.
  private restartCount = 0;

  /**
   * Registers the provider with VS Code.
   *
   * @param vs - The VS Code API instance.
   * @param authChange - Fires when the Google Cloud Platform session is added,
   * removed, or changed.
   * @param connectionRefresher - Keeps the server's access token fresh.
   */
  constructor(
    private readonly vs: typeof vscode,
    authChange: vscode.Event<AuthChangeEvent>,
    private readonly connectionRefresher: ConnectionRefresher,
  ) {
    this.emitter = new vs.EventEmitter<void>();
    this.onDidChangeMcpServerDefinitions = this.emitter.event;
    // Signing in or out changes the token, so a running server must restart.
    this.authListener = authChange(() => {
      this.restartServer();
    });
    this.registration = vs.lm.registerMcpServerDefinitionProvider(
      CONTROL_PLANE_MCP_ID,
      this,
    );
  }

  /**
   * Describes the server without a token, since VS Code calls this eagerly.
   *
   * @returns The server definition.
   */
  provideMcpServerDefinitions(): vscode.McpHttpServerDefinition[] {
    const clientHeader = getWorkbenchClientHeaderWithVersion();
    return [
      new this.vs.McpHttpServerDefinition(
        'Workbench Control Plane',
        this.vs.Uri.parse(CONFIG.ControlPlaneMcpUrl),
        { [clientHeader.key]: clientHeader.value },
        this.restartCount.toString(),
      ),
    ];
  }

  /**
   * Adds the session's access token right before VS Code starts the server.
   *
   * @param server - The definition returned by
   * {@link provideMcpServerDefinitions}.
   * @returns A copy of the definition carrying the current access token.
   */
  async resolveMcpServerDefinition(
    server: vscode.McpHttpServerDefinition,
  ): Promise<vscode.McpHttpServerDefinition> {
    // VS Code reads headers once per start, so restart the server on refresh.
    const connection: RefreshableConnection = {
      token: '',
      tokenExpiry: new Date(0),
      headers: { ...server.headers },
      onDidRefresh: () => {
        this.restartServer();
      },
    };
    await this.connectionRefresher.refresh(CONTROL_PLANE_MCP_ID, connection);
    return new this.vs.McpHttpServerDefinition(
      server.label,
      server.uri,
      connection.headers,
      server.version,
    );
  }

  /** Unregisters the provider and stops listening for session changes. */
  dispose(): void {
    this.registration.dispose();
    this.authListener.dispose();
    this.emitter.dispose();
  }

  private restartServer(): void {
    this.restartCount++;
    this.emitter.fire();
  }
}
