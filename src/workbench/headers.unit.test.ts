/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { expect } from 'chai';
import * as sinon from 'sinon';
import { getExtensionVersion } from './headers';

describe('headers', () => {
  afterEach(() => {
    sinon.restore();
  });

  describe('getExtensionVersion', () => {
    it('returns version from package.json', () => {
      const mockFs = {
        readFileSync: sinon.stub().returns(JSON.stringify({ version: '1.2.3' }))
      } as unknown as typeof fs;

      const mockPath = {
        resolve: sinon.stub().returns('mock/path/package.json')
      } as unknown as typeof path;

      expect(getExtensionVersion(mockFs, mockPath)).to.equal('1.2.3');
    });

    it('returns fallback version if package.json has no version', () => {
      const mockFs = {
        readFileSync: sinon.stub().returns(JSON.stringify({}))
      } as unknown as typeof fs;

      const mockPath = {
        resolve: sinon.stub().returns('mock/path/package.json')
      } as unknown as typeof path;

      expect(getExtensionVersion(mockFs, mockPath)).to.equal('0.0.0');
    });

    it('returns fallback version if readFileSync throws', () => {
      const mockFs = {
        readFileSync: sinon.stub().throws(new Error('File not found'))
      } as unknown as typeof fs;

      const mockPath = {
        resolve: sinon.stub().returns('mock/path/package.json')
      } as unknown as typeof path;

      expect(getExtensionVersion(mockFs, mockPath)).to.equal('0.0.0');
    });

    it('returns fallback version if JSON is invalid', () => {
      const mockFs = {
        readFileSync: sinon.stub().returns('not json')
      } as unknown as typeof fs;

      const mockPath = {
        resolve: sinon.stub().returns('mock/path/package.json')
      } as unknown as typeof path;

      expect(getExtensionVersion(mockFs, mockPath)).to.equal('0.0.0');
    });
  });
});
