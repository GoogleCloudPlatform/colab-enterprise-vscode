/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ActionableLogLevel, LogLevel } from './logger';

export function buildTimestampLevelPrefix(level: ActionableLogLevel): string {
  const timestamp = new Date().toISOString();
  const levelStr = LogLevel[level].toUpperCase();
  return `[${levelStr}] ${timestamp}`;
}
