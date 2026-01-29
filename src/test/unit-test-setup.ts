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
let vscodeStub: ReturnType<typeof newVsCodeStub>["asVsCode"] | undefined;

// @ts-ignore
Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    if (!vscodeStub) {
      // @ts-ignore
      vscodeStub = newVsCodeStub().asVsCode();
    }
    return vscodeStub;
  }
  // @ts-ignore
  return originalRequire.call(this, id);
};
