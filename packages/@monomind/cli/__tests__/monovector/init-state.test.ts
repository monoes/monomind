import { describe, it, expect } from 'vitest';
import { createInitState } from '../../src/monovector/init-state.js';

describe('createInitState', () => {
  it('starts as pending: canTry true, isReady false, isFailed false', () => {
    const s = createInitState();
    expect(s.canTry()).toBe(true);
    expect(s.isReady()).toBe(false);
    expect(s.isFailed()).toBe(false);
    expect(s.attempts()).toBe(0);
  });

  it('becomes ready after markReady — canTry returns false', () => {
    const s = createInitState();
    s.markReady();
    expect(s.isReady()).toBe(true);
    expect(s.canTry()).toBe(false);
    expect(s.isFailed()).toBe(false);
  });

  it('permanently fails after maxAttempts', () => {
    const s = createInitState({ maxAttempts: 2 });
    s.markFailed(); // 1 of 2
    expect(s.canTry()).toBe(true);
    expect(s.isFailed()).toBe(false);
    s.markFailed(); // 2 of 2
    expect(s.canTry()).toBe(false);
    expect(s.isFailed()).toBe(true);
  });

  it('tracks attempt count correctly', () => {
    const s = createInitState({ maxAttempts: 5 });
    s.markFailed();
    s.markFailed();
    expect(s.attempts()).toBe(2);
    expect(s.isFailed()).toBe(false); // only 2 of 5
  });

  it('default maxAttempts is 3', () => {
    const s = createInitState();
    s.markFailed();
    s.markFailed();
    expect(s.canTry()).toBe(true);
    s.markFailed();
    expect(s.isFailed()).toBe(true);
  });

  it('markPermanentlyFailed immediately sets isFailed without retries', () => {
    const s = createInitState({ maxAttempts: 5 });
    s.markPermanentlyFailed();
    expect(s.isFailed()).toBe(true);
    expect(s.canTry()).toBe(false);
    expect(s.attempts()).toBe(5); // count is set to max
  });
});
