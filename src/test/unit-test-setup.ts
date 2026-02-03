/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Module from 'module';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { newVsCodeStub } from './helpers/vscode';

chai.use(chaiAsPromised);

// Patch Node.js module loader to mock the 'vscode' dependency.
// Unit tests run in standard Node.js, where the 'vscode' module doesn't exist.
// Importing 'vscode' would throw "Error: Cannot find module 'vscode'".
// Intercepting require calls to return our stub for 'vscode', while
// normal for all other modules
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRequire = Module.prototype.require;
const vscodeStub = newVsCodeStub().asVsCode();

Module.prototype.require = function (this: unknown, id: string) {
  if (id === 'vscode') {
    return vscodeStub;
  }
  // For others, we MUST return the original require result.
  // Disable unsafe-return as require() returns 'any'.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return originalRequire.apply(this, [id]);
};
