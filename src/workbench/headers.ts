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
n * The HTTP header for the Workbench client agent used for requests originating
 * from VS Code.
 */
export const WORKBENCH_CLIENT_AGENT_HEADER: StaticHeader = {
  key: 'X-Workbench-Client-Agent',
  value: 'vscode',
};

/**
 * The HTTP header for JSON content type.
 */
export const CONTENT_TYPE_JSON_HEADER: StaticHeader = {
  key: 'Content-Type',
  value: 'application/json',
};

/**
 * The HTTP header for the authorization token.
 */
export const AUTHORIZATION_HEADER: Header = {
  key: 'Authorization',
};
