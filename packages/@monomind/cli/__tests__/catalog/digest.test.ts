import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageDigest } from '../../src/catalog/digest.js';

const pkg = (files: Record<string, string>): string => {
  const dir = mkdtempSync(join(tmpdir(), 'cat-dig-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
};

describe('packageDigest', () => {
  it('is stable across creation order and sensitive to path/content boundaries', () => {
    const a = packageDigest(pkg({ 'SKILL.md': 'x', 'ref/a.md': 'yz' }));
    const b = packageDigest(pkg({ 'ref/a.md': 'yz', 'SKILL.md': 'x' }));
    const c = packageDigest(pkg({ 'SKILL.md': 'xy', 'ref/a.md': 'z' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
  it('refuses symlinks inside the package', () => {
    const dir = pkg({ 'SKILL.md': 'x' });
    symlinkSync('/etc/hostname', join(dir, 'link.md'));
    expect(() => packageDigest(dir)).toThrow(/symlink/);
  });
});
