// packages/@monomind/cli/__tests__/orgrt/state-detector.test.ts
import { describe, it, expect } from 'vitest';
import { StateDetector } from '../../src/orgrt/state-detector.js';

describe('StateDetector', () => {
  it('starts idle', () => {
    const d = new StateDetector();
    expect(d.current()).toBe('idle');
  });

  it('detects working from assistant text', () => {
    const d = new StateDetector();
    d.onMessage('assistant', undefined, 'I will now implement the feature');
    expect(d.current()).toBe('working');
  });

  it('detects tool-call from tool_use message', () => {
    const d = new StateDetector();
    d.onMessage('tool_use');
    expect(d.current()).toBe('tool-call');
  });

  it('returns to idle on success result', () => {
    const d = new StateDetector();
    d.onMessage('assistant', undefined, 'working on it');
    expect(d.current()).toBe('working');
    d.onMessage('result', 'success');
    expect(d.current()).toBe('idle');
  });

  it('detects error state from result', () => {
    const d = new StateDetector();
    d.onMessage('result', 'error');
    expect(d.current()).toBe('error');
  });

  it('detects error from assistant text pattern', () => {
    const d = new StateDetector();
    d.onMessage('assistant', undefined, 'Error: the build failed with an exception');
    expect(d.current()).toBe('error');
  });

  it('detects blocked state from text pattern', () => {
    const d = new StateDetector();
    d.onMessage('assistant', undefined, 'I am waiting for human approval on the gate');
    expect(d.current()).toBe('blocked');
  });

  it('detects completed state from text pattern', () => {
    const d = new StateDetector();
    d.onMessage('assistant', undefined, 'The task is completed successfully');
    expect(d.current()).toBe('completed');
  });

  it('checkIdle transitions to idle after threshold', () => {
    const d = new StateDetector(undefined, 10); // 10ms threshold
    d.onMessage('assistant', undefined, 'working');
    expect(d.current()).toBe('working');
    // Simulate time passage
    const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
    return wait(20).then(() => {
      d.checkIdle();
      expect(d.current()).toBe('idle');
    });
  });
});
