/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { JupyterServerCommand } from "@vscode/jupyter-extension";

/**
 * Command that triggers the multi-step flow to connect to a Google Cloud
 * Workbench instance. This flow allows users to select a GCP project and then
 * pick an active Workbench notebook instance to use as a remote Jupyter
 * server.
 */
export const WORKBENCH_COMMAND: JupyterServerCommand = {
  label: "Workbench",
  description: "Connect to Google Cloud Workbench",
};
