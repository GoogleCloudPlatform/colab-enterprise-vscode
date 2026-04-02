/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import vscode from 'vscode';
import { AuthChangeEvent } from '../auth/auth-provider';

const SIGN_OUT_TIMEOUT_MS = 30 * 1000;

/**
 * Workaround to force the Jupyter extension to clean up remote server and
 * kernel lists after sign-out.
 *
 * Jupyter can suffer from race conditions where a sign-out event is processed
 * while still using cached data, causing unnecessary reconnect attempts or
 * revert to a cached kernel list.
 *
 * To fix this, this manager enters a 30-second window after sign-out where it
 * duplicates incoming server change events (fires them a second time with
 * `setTimeout(..., 0)`). This ensures a second event arrives after any race
 * conditions settle, forcing Jupyter to acknowledge the empty server list.
 *
 * To prevent the duplicate event from triggering a third event (infinite loop),
 * it ignores every other call during this window.
 */
export class ConnectionManager implements vscode.Disposable {
  private activeUntil = 0;
  private ignoreNext = false;
  private readonly authListener: vscode.Disposable;

  constructor(
    authEvent: vscode.Event<AuthChangeEvent>,
    private readonly serverChangeEmitter: vscode.EventEmitter<void>,
  ) {
    this.authListener = authEvent(this.handleAuthChange.bind(this));
  }

  dispose() {
    this.authListener.dispose();
  }

  private handleAuthChange(e: AuthChangeEvent) {
    if (!e.hasValidSession) {
      this.activeUntil = Date.now() + SIGN_OUT_TIMEOUT_MS;
      this.ignoreNext = false;
    } else {
      // Successful login stops duplicating events
      this.activeUntil = 0;
    }
  }

  /**
   * Prevents persistent reconnection attempts by duplicating server change
   * events. This is only active during the timeout window after sign-out.
   * To prevent infinite loops of self-triggering events, it alternates between
   * scheduling a duplicate event and ignoring the next incoming event.
   */
  preventReconnectionAttempt() {
    if (Date.now() > this.activeUntil) {
      return;
    }

    if (this.ignoreNext) {
      this.ignoreNext = false;
      return;
    }

    this.ignoreNext = true;
    setTimeout(() => {
      this.serverChangeEmitter.fire();
    }, 0);
  }
}
