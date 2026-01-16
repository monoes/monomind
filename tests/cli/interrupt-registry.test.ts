import { describe, it, expect, beforeEach } from 'vitest';

import { InterruptRegistry } from '../../packages/@monobrain/cli/src/interactive/interrupt.js';

describe('InterruptRegistry', () => {
  let registry: InterruptRegistry;

  beforeEach(() => {
    registry = new InterruptRegistry();
  });

  it('shouldInterrupt returns true for listed agent slug', () => {
    registry.load({ interruptBefore: ['security-auditor'] });
    expect(registry.shouldInterrupt('security-auditor')).toBe(true);
  });

  it('shouldInterrupt returns false for unlisted agent slug', () => {
    registry.load({ interruptBefore: ['security-auditor'] });
    expect(registry.shouldInterrupt('coder')).toBe(false);
  });

  it('shouldInterrupt returns false when autoApprove is true', () => {
    registry.load({ interruptBefore: ['coder'], autoApprove: true });
    expect(registry.shouldInterrupt('coder')).toBe(false);
  });

  it('shouldInterrupt returns true when confidence below threshold', () => {
    registry.load({ interruptBefore: [], confidenceThreshold: 0.8 });
    expect(registry.shouldInterrupt('coder', 0.5)).toBe(true);
  });

  it('shouldInterrupt returns false when confidence above threshold', () => {
    registry.load({ interruptBefore: [], confidenceThreshold: 0.8 });
    expect(registry.shouldInterrupt('coder', 0.9)).toBe(false);
  });

  it('shouldInterrupt returns false when no config loaded', () => {
    expect(registry.shouldInterrupt('coder')).toBe(false);
  });
});
