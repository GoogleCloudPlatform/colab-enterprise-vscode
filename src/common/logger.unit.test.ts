/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { assert } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { log, initializeLogger } from './logging/logger';

describe('Logger', () => {
  let sandbox: sinon.SinonSandbox;
  let createOutputChannelStub: sinon.SinonStub;
  let getConfigurationStub: sinon.SinonStub;
  let outputChannelMock: {
    appendLine: sinon.SinonStub;
    dispose: sinon.SinonStub;
    show: sinon.SinonStub;
  };
  let consoleInfoStub: sinon.SinonStub;
  let loggerDisposable: vscode.Disposable | undefined;

  const mockContext = {
    extensionMode: vscode.ExtensionMode.Production,
    extension: {
      packageJSON: {
        version: '1.2.3',
      },
    },
  } as unknown as vscode.ExtensionContext;

  beforeEach(() => {
    sandbox = sinon.createSandbox();

    outputChannelMock = {
      appendLine: sandbox.stub(),
      dispose: sandbox.stub(),
      show: sandbox.stub(),
    };

    createOutputChannelStub = vscode.window
      .createOutputChannel as sinon.SinonStub;
    createOutputChannelStub.returns(outputChannelMock);

    // Mock configuration
    const configMock = {
      get: sandbox.stub().returns('info'),
    };
    getConfigurationStub = vscode.workspace.getConfiguration as sinon.SinonStub;
    getConfigurationStub.returns(configMock);

    // Mock onDidChangeConfiguration
    (vscode.workspace.onDidChangeConfiguration as sinon.SinonStub).returns({
      dispose: sandbox.stub(),
    });

    // Mock console methods
    sandbox.stub(console, 'log');
    consoleInfoStub = sandbox.stub(console, 'info');
    sandbox.stub(console, 'warn');
    sandbox.stub(console, 'error');
  });

  afterEach(() => {
    if (loggerDisposable) {
      loggerDisposable.dispose();
    }
    createOutputChannelStub.reset();
    getConfigurationStub.reset();
    sandbox.restore();
  });

  describe('initializeLogger', () => {
    it('creates output channel "Workbench"', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      sinon.assert.calledWith(createOutputChannelStub, 'Workbench');
    });

    it('logs environment info on initialization', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*Visual Studio Code: 1.109.5/),
      );
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*Remote: local/),
      );
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*Workbench extension version: 1.2.3/),
      );
    });

    it('throws if initialized twice', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      assert.throws(() => {
        initializeLogger(vscode, mockContext);
      }, 'Loggers have already been initialized.');
    });

    it('adds ConsoleLogger in Development mode', () => {
      const devContext = {
        ...mockContext,
        extensionMode: vscode.ExtensionMode.Development,
      } as unknown as vscode.ExtensionContext;

      loggerDisposable = initializeLogger(vscode, devContext);

      // Verify console logger is active
      log.info('test message');
      sinon.assert.calledWith(
        consoleInfoStub,
        sinon.match(/\[INFO\].*test message/),
      );

      // Verify output channel is shown
      sinon.assert.calledWith(outputChannelMock.show, true);
    });

    it('does not add ConsoleLogger in Production mode', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);

      log.info('test message');
      sinon.assert.notCalled(consoleInfoStub);
    });
  });

  describe('log', () => {
    afterEach(() => {
      if (loggerDisposable) {
        loggerDisposable.dispose();
      }
    });

    it('logs info message when level is info', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      log.info('test message');
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*test message/),
      );
    });

    it('logs error message when level is info', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      log.error('error message');
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[ERROR\].*error message/),
      );
    });

    it('does not log debug message when level is info', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      log.debug('debug message');
      // note: appendLine is called for env logs, so we check specifically for
      // debug message
      sinon.assert.neverCalledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[DEBUG\].*debug message/),
      );
    });

    it('logs debug message when level is debug', () => {
      // Re-mock config for this test
      getConfigurationStub.returns({
        get: sandbox.stub().returns('debug'),
      });

      loggerDisposable = initializeLogger(vscode, mockContext);

      log.debug('debug message');
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[DEBUG\].*debug message/),
      );
    });

    it('does not log info message when level is error', () => {
      // Re-mock config for this test
      getConfigurationStub.returns({
        get: sandbox.stub().returns('error'),
      });

      loggerDisposable = initializeLogger(vscode, mockContext);

      log.info('info message');
      sinon.assert.neverCalledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*info message/),
      );
    });

    it('handles Error objects in error log', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      log.error(new Error('error object message') as unknown as string);
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[ERROR\].*error object message/),
      );
    });

    it('defaults to Info level if config is invalid', () => {
      getConfigurationStub.returns({
        get: sandbox.stub().returns('invalid-level'),
      });

      loggerDisposable = initializeLogger(vscode, mockContext);

      log.info('info message');
      sinon.assert.calledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[INFO\].*info message/),
      );

      log.debug('debug message');
      sinon.assert.neverCalledWith(
        outputChannelMock.appendLine,
        sinon.match(/\[DEBUG\].*debug message/),
      );
    });
  });

  describe('dispose', () => {
    it('disposes output channel', () => {
      loggerDisposable = initializeLogger(vscode, mockContext);
      loggerDisposable.dispose();
      sinon.assert.called(outputChannelMock.dispose);
    });
  });
});
