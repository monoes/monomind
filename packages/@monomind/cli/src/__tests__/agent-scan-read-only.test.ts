/**
 * `monomind agent scan` is a read-only probe that callers (mono-agent's
 * System health) run on a timer: it must not run the startup update check
 * (writes ~/.monomind/update-state.json after a network call) or the
 * subsystem init (writes .monomind/registry.json in the cwd).
 */

import { describe, expect, it } from 'vitest';
import { isReadOnlyProbe } from '../index.js';

describe('isReadOnlyProbe', () => {
  it('matches agent scan with any flags', () => {
    expect(isReadOnlyProbe(['agent', 'scan'])).toBe(true);
    expect(isReadOnlyProbe(['agent', 'scan', '--json'])).toBe(true);
    expect(isReadOnlyProbe(['agent', '--json', 'scan', '--installed'])).toBe(true);
  });
  it('does not match anything else', () => {
    expect(isReadOnlyProbe(['agent', 'exec'])).toBe(false);
    expect(isReadOnlyProbe(['doctor'])).toBe(false);
    expect(isReadOnlyProbe([])).toBe(false);
  });
});
