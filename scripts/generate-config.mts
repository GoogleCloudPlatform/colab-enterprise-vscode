/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const envConfig = {
  clientId: process.env.WORKBENCH_EXTENSION_CLIENT_ID,
  clientNotSoSecret: process.env.WORKBENCH_EXTENSION_CLIENT_NOT_SO_SECRET,
};

try {
  if (!envConfig.clientId) {
    throw new Error('WORKBENCH_EXTENSION_CLIENT_ID is not set');
  }
  if (!envConfig.clientNotSoSecret) {
    throw new Error('WORKBENCH_EXTENSION_CLIENT_NOT_SO_SECRET is not set');
  }
} catch (err: unknown) {
  console.error(err);
  process.exit(1);
}

const config = {
  ClientId: envConfig.clientId,
  ClientNotSoSecret: envConfig.clientNotSoSecret,
};

const currentYear = new Date().getFullYear();
const licenseHeader = `/**
 * @license
 * Copyright ${currentYear.toString()} Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */`;

const output = `${licenseHeader}

// AUTO-GENERATED. Do not edit.
//
// Generate with \`npm run generate-config\` after updating environment
// variables (see \`.env.template\`).

/* eslint-disable @cspell/spellchecker */
export const CONFIG = ${JSON.stringify(config, null, 2)} as const;
`;

const configFile = path.join(__dirname, '../src/config.ts');

await fs.writeFile(configFile, output);
console.log('✅ Wrote src/config.ts');
