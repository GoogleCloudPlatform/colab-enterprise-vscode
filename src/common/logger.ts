/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as vscode from 'vscode';

export enum LogLevel {
  Off = 'off',
  Error = 'error',
  Warn = 'warn',
  Info = 'info',
  Debug = 'debug',
}

interface ILogger {
  log(level: LogLevel, message: string): void;
}

const ORDERED_LOG_LEVELS: LogLevel[] = [
  LogLevel.Off,
  LogLevel.Error,
  LogLevel.Warn,
  LogLevel.Info,
  LogLevel.Debug,
];

const loggers: ILogger[] = [];

class OutputChannelLogger implements ILogger {
  constructor(private readonly outputChannel: vscode.OutputChannel) { }

  log(level: LogLevel, message: string) {
    this.outputChannel.appendLine(
      `[${level.toUpperCase()}] ${new Date().toISOString()} ${message}`,
    );
  }
}

class ConsoleLogger implements ILogger {
  log(level: LogLevel, message: string) {
    console.log(`[${level.toUpperCase()}] ${message}`);
  }
}

let logLevel = LogLevel.Info;

function getConfiguredLogLevel(vs: typeof vscode): LogLevel {
  const configLevel = vs.workspace
    .getConfiguration('workbench')
    .get<string>('logging.level', 'info');
  return isLogLevel(configLevel) ? configLevel : LogLevel.Info;
}

function isLogLevel(arg: string): arg is LogLevel {
  return ORDERED_LOG_LEVELS.some((l: string) => l === arg);
}

function log(level: LogLevel, message: string) {
  const currentLevelIndex = ORDERED_LOG_LEVELS.indexOf(logLevel);
  const messageLevelIndex = ORDERED_LOG_LEVELS.indexOf(level);

  if (currentLevelIndex >= messageLevelIndex && messageLevelIndex > 0) {
    loggers.forEach((l) => {
      l.log(level, message);
    });
  }
}

export function initializeLogger(
  vs: typeof vscode,
  context: vscode.ExtensionContext,
): vscode.Disposable {
  if (loggers.length > 0) {
    throw new Error('Loggers have already been initialized.');
  }

  logLevel = getConfiguredLogLevel(vs);
  const configListener = vs.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration('workbench.logging.level')) {
      logLevel = getConfiguredLogLevel(vs);
    }
  });

  // Create the output channel once.
  const outputChannel = vs.window.createOutputChannel('Workbench');
  loggers.push(new OutputChannelLogger(outputChannel));

  if (context.extensionMode === vs.ExtensionMode.Development) {
    outputChannel.show(true);
    loggers.push(new ConsoleLogger());
  }

  const packageJSON = context.extension.packageJSON as { version: string };
  Logger.info(`Visual Studio Code: ${vs.version}`);
  Logger.info(`Remote: ${vs.env.remoteName || 'local'}`);
  Logger.info(`App Host: ${vs.env.appHost}`);
  Logger.info(`Workbench extension version: ${packageJSON.version}`);

  return {
    dispose: () => {
      configListener.dispose();
      outputChannel.dispose();
      loggers.length = 0;
    },
  };
}

export const Logger = {
  info(message: string) {
    log(LogLevel.Info, message);
  },

  warn(message: string) {
    log(LogLevel.Warn, message);
  },

  error(message: string | Error) {
    log(
      LogLevel.Error,
      message instanceof Error ? message.message : message,
    );
  },

  debug(message: string) {
    log(LogLevel.Debug, message);
  },
};
