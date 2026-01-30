/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from "vscode";

/**
 * Executes an asynchronous operation and handles any errors by showing
 * a modal error message.
 *
 * @param operation - The asynchronous operation to execute.
 * @param defaultValue - The value to return if the operation fails.
 * @param errorMessage - The error message to display in the modal.
 * @returns The result of the operation or the default value if an error occurs.
 */
export async function withError<T>(
  operation: () => Promise<T>,
  defaultValue: T,
  errorMessage: string,
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showErrorMessage(`${errorMessage}: ${message}`);
    return defaultValue;
  }
}
