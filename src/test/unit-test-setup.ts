/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";

chai.use(chaiAsPromised);

import Module from "module";
import { newVsCodeStub } from "./helpers/vscode";

// Patch require to return a stub for the vscode module.
const originalRequire = Module.prototype.require;
const vscodeStub = newVsCodeStub().asVsCode();

Module.prototype.require = function (this: unknown, id: string) {
  if (id === "vscode") {
    return vscodeStub;
  }
  return originalRequire.apply(this, [id]);
} as NodeJS.Require;