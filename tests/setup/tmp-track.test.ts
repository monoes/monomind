import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from './tmp-track.js';

describe('tracked mkdtempSync', () => {
  it('makes a real directory under TMPDIR', () => {
    const d = mkdtempSync(join(tmpdir(), 'track-'));
    expect(existsSync(d)).toBe(true);
    expect(d.startsWith(tmpdir())).toBe(true);
  });
});
