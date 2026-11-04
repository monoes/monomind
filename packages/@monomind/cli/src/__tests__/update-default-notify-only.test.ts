import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../update/checker.js';

describe('update defaults are notify-only', () => {
  it('auto-updates no semver level by default', () => {
    expect(DEFAULT_CONFIG.autoUpdate).toEqual({ patch: false, minor: false, major: false });
  });
});
