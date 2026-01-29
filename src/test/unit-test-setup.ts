/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import Module from "module";
import * as chai from "chai";
import chaiAsPromised from "chai-as-promised";

// @ts-expect-error: Build output structure aligns for runtime.
// This file is built to `out/test/test/unit-test-setup.js`.
// At runtime, the required module is located at `out/test/vscode.js`.
// esbuild resolves relative to source (`src/test/unit-test-setup.ts`),
// where `../vscode` (src/vscode.ts) does not exist.
import { newVsCodeStub } from "../vscode";

chai.use(chaiAsPromised);

// Patch require to return a stub for vscode
// eslint-disable-next-line @typescript-eslint/unbound-method
const originalRequire = Module.prototype.require;
let vscodeStub: unknown;

Module.prototype.require = function (id: string) {
  if (id === "vscode") {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    vscodeStub ??= newVsCodeStub().asVsCode();
    return vscodeStub;
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-return
  return originalRequire.call(this, id);
};
