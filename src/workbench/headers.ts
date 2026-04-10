/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getExtension, getPackageInfo } from '../config/package-info';

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

/**
 * The HTTP header for the Workbench client agent used for requests originating
 * from VS Code.
 *
 * IMPORTANT: This exact header value prefix ('vertex-ai-workbench-vscode-ext/')
 * is used to monitor the extension on the Google side. Do not modify it without
 * verifying the impact on monitoring.
 */
export const getWorkbenchClientHeaderWithVersion = () => {
  const version = getPackageInfo(getExtension()).version;
  return {
    key: 'X-Goog-Api-Client',
    value: `vertex-ai-workbench-vscode-ext/${version}`,
  };
};
