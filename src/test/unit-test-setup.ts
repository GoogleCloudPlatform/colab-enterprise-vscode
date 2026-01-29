/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import Module from "module";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";
// @ts-ignore
import { newVsCodeStub } from "../vscode";

chai.use(chaiAsPromised);

// Patch require to return a stub for vscode
const originalRequire = Module.prototype.require;
// @ts-ignore
Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    // @ts-ignore
    return newVsCodeStub().asVsCode();
  }
  // @ts-ignore
  return originalRequire.call(this, id);
};
