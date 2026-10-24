import { spawn } from 'node:child_process';
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

  // CI flake: a file-level "ENOTEMPTY: directory not empty, rmdir /tmp/mm-test-run-home-..." in teardown.
  // Something (a leaked timer, a daemon's last write) was still creating files while the tree was
  // removed, so the final rmdir found a non-empty directory. A short retry lets the writer finish.
  it('removes a tree that another process is still writing into', async () => {
    const root = mkdtempSync(join(tmpdir(), 'rt-busy-'));
    // Writes files into the tree for about 700 ms, then exits (a separate process, so it really
    // overlaps the synchronous removal below).
    const writer = spawn(
      process.execPath,
      [
        '-e',
        [
          "const fs = require('fs'), path = require('path');",
          'const dir = process.argv[1], end = Date.now() + 700;',
          'for (let i = 0; Date.now() < end; i++) {',
          "  const sub = path.join(dir, 's' + (i % 5));",
          '  fs.mkdirSync(sub, { recursive: true });',
          "  fs.writeFileSync(path.join(sub, 'f' + i), 'x');",
          '}',
        ].join('\n'),
        root,
      ],
      { stdio: 'ignore' },
    );
    const exited = new Promise<void>((resolve) => writer.on('exit', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 150)); // let it get going
    try {
      expect(() => removeTree(root)).not.toThrow();
      expect(existsSync(root)).toBe(false);
    } finally {
      writer.kill();
      await exited;
    }
  });
});
