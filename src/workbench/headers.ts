/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * An HTTP header key.
 */
export interface Header {
  /**
   * The name of the header.
   */
  readonly key: string;
}

/**
 * An HTTP header with a key and static value.
 */
export interface StaticHeader extends Header {
  /**
   * The value of the header.
   */
  readonly value: string;
}

/**
 * The HTTP header for the Colab client agent used for requests originating from
 * VS Code.
 */
export const WORKBENCH_CLIENT_AGENT_HEADER: StaticHeader = {
  key: "X-Workbench-Client-Agent",
  value: "vscode",
};
