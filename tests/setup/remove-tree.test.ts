import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { removeTree } from './remove-tree.js';

describe('removeTree', () => {
  it('removes a tree with a read-only directory in it', () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-'));
    const ro = join(root, 'inputs', 'workspace');
    mkdirSync(ro, { recursive: true });
    writeFileSync(join(ro, 'f'), 'x');
    chmodSync(ro, 0o500);
    chmodSync(join(root, 'inputs'), 0o500);
    removeTree(root);
    expect(existsSync(root)).toBe(false);
  });

  it('is fine with a path that is not there', () => {
    expect(() => removeTree(join(tmpdir(), 'rt-missing-xyz'))).not.toThrow();
  });
});
