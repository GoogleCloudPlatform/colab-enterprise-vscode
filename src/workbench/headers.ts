/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';

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

// Read version from vscode extension
export function getExtensionVersion(): string {
  try {
    const extension = vscode.extensions.getExtension('google.workbench');
    const extPackageJSON = extension?.packageJSON as
      | { version?: string }
      | undefined;
    return extPackageJSON?.version ?? '0.0.0';
  } catch (error) {
    console.error('Failed to load extension version:', error);
    return '0.0.0'; // Fallback version
  }
}

const EXTENSION_VERSION = getExtensionVersion();

/**
 * The HTTP header for the Workbench client agent used for requests originating
 * from VS Code.
 *
 * IMPORTANT: This exact header value prefix ('vertex-ai-workbench-vscode-ext/')
 * is used to track extension usage on the Google side. Do not modify it without
 * verifying the impact on analytics and tracking.
 */
export const WORKBENCH_CLIENT_AGENT_HEADER: StaticHeader = {
  key: 'X-Goog-Api-Client',
  value: `vertex-ai-workbench-vscode-ext/${EXTENSION_VERSION}`,
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
