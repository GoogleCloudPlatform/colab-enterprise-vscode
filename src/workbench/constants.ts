/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { JupyterServerCommand } from '@vscode/jupyter-extension';

/** Identifying information for a Workbench command. */
export interface Command {
  /** The human readable label of the registered command. */
  label: string;
  /** An optional description of the command. */
  description?: string;
}

/** Identifying information for a Workbench-registered command. */
export interface RegisteredCommand extends Command {
  /** The ID of the registered command. */
  id: string;
}

/**
 * Command that triggers the multi-step flow to connect to a Google Cloud
 * Workbench instance. This flow allows users to select a GCP project and then
 * pick an active Workbench notebook instance to use as a remote Jupyter
 * server.
 */
export const WORKBENCH_COMMAND: JupyterServerCommand = {
  label: 'Workbench',
  description: 'Connect to Vertex AI Workbench',
};

export const NO_ACTIVE_INSTANCE_LABEL =
  'No active Workbench instances found in the project, enable them by visiting';
