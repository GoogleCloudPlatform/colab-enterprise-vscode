/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { expect } from 'chai';
import sinon from 'sinon';
import { AuthChangeEvent } from '../auth/auth-provider';
import { TestEventEmitter } from '../test/helpers/events';
import { ConnectionManager } from './connection-manager';

describe('ConnectionManager', () => {
  let authEventEmitter: TestEventEmitter<AuthChangeEvent>;
  let connectionManager: ConnectionManager;
  let clock: sinon.SinonFakeTimers;

  beforeEach(() => {
    authEventEmitter = new TestEventEmitter<AuthChangeEvent>();
    clock = sinon.useFakeTimers();
    // Advance clock to avoid Date.now() === 0 edge case in tests
    clock.tick(1000);
    connectionManager = new ConnectionManager(authEventEmitter.event);
  });

  afterEach(() => {
    clock.restore();
    sinon.restore();
    connectionManager.dispose();
  });

  describe('lifecycle', () => {
    it('subscribes to auth events on creation', () => {
      expect(authEventEmitter.hasListeners()).to.be.true;
    });

    it('unsubscribes on dispose', () => {
      connectionManager.dispose();
      expect(authEventEmitter.hasListeners()).to.be.false;
    });
  });

  describe('handleAuthChange', () => {
    it('sets active window on sign-out', () => {
      authEventEmitter.fire({
        added: [],
        removed: [],
        changed: [],
        hasValidSession: false,
      } as unknown as AuthChangeEvent);

      // It should be active now
      const callback = sinon.stub();
      connectionManager.preventReconnectionAttempt(callback);

      // Callback should be called (scheduled)
      expect(callback.called).to.be.false; // It's scheduled via setTimeout
      clock.tick(0);
      expect(callback.calledOnce).to.be.true;
    });

    it('resets active window on sign-in', () => {
      authEventEmitter.fire({
        added: [],
        removed: [],
        changed: [],
        hasValidSession: false,
      } as unknown as AuthChangeEvent);

      authEventEmitter.fire({
        added: [],
        removed: [],
        changed: [],
        hasValidSession: true,
      } as unknown as AuthChangeEvent);

      const callback = sinon.stub();
      connectionManager.preventReconnectionAttempt(callback);

      clock.tick(0);
      expect(callback.called).to.be.false; // Window reset, so should do nothing
    });
  });

  describe('preventReconnectionAttempt', () => {
    beforeEach(() => {
      // Enter the window
      authEventEmitter.fire({
        added: [],
        removed: [],
        changed: [],
        hasValidSession: false,
      } as unknown as AuthChangeEvent);
    });

    it('schedules duplicate event on first call', () => {
      const callback = sinon.stub();
      connectionManager.preventReconnectionAttempt(callback);

      clock.tick(0);
      expect(callback.calledOnce).to.be.true;
    });

    it('ignores the second call after a duplicate was scheduled', () => {
      const callback1 = sinon.stub();
      const callback2 = sinon.stub();

      connectionManager.preventReconnectionAttempt(callback1);
      clock.tick(0);
      expect(callback1.calledOnce).to.be.true;

      connectionManager.preventReconnectionAttempt(callback2);
      clock.tick(0);
      expect(callback2.called).to.be.false; // Ignored
    });

    it('resumes scheduling on the third call after an ignored call', () => {
      const callback1 = sinon.stub();
      const callback2 = sinon.stub();
      const callback3 = sinon.stub();

      connectionManager.preventReconnectionAttempt(callback1);
      clock.tick(0);

      connectionManager.preventReconnectionAttempt(callback2);
      clock.tick(0);

      connectionManager.preventReconnectionAttempt(callback3);
      clock.tick(0);
      expect(callback3.calledOnce).to.be.true;
    });

    it('does nothing after the 30-second window expires', () => {
      const callback = sinon.stub();

      // Advance clock by 31 seconds
      clock.tick(31000);

      connectionManager.preventReconnectionAttempt(callback);
      clock.tick(0);
      expect(callback.called).to.be.false;
    });
  });
});
