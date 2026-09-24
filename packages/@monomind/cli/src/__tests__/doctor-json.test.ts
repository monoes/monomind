import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doctorCommand } from '../commands/doctor.js';
import type { CommandContext } from '../types.js';

// `doctor --json` is the doctor-json capability callers (mono-agent) parse:
// stdout must hold exactly one JSON document, whatever the checks print.

function ctx(flags: Record<string, unknown>): CommandContext {
  return { args: [], flags: { _: [], ...flags }, cwd: process.cwd(), interactive: false };
}

async function captureStdout(run: () => Promise<unknown>): Promise<string> {
  const original = process.stdout.write.bind(process.stdout);
  let captured = '';
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  try {
    await run();
  } finally {
    process.stdout.write = original;
  }
  return captured;
}

describe('doctor --json', () => {
  let dir: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    dir = mkdtempSync(join(tmpdir(), 'doctor-json-test-'));
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(dir, { recursive: true, force: true });
  });

  it('prints only the v1 payload on stdout, with component ids and fix safety', async () => {
    const out = await captureStdout(() =>
      doctorCommand.action!(ctx({ json: true, component: 'gitignore' })),
    );
    const payload = JSON.parse(out);
    expect(payload.v).toBe(1);
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0]).toMatchObject({
      component: 'gitignore',
      name: 'Gitignore Coverage',
      status: 'warn',
      fix_safety: 'auto',
      fix_flag: '--fix',
    });
    expect(payload.summary).toEqual({ passed: 0, warnings: 1, failed: 0, info: 0 });
    expect(payload.fixes).toEqual([]);
  }, 30000);

  it('--fix --json applies the fix and reports its outcome', async () => {
    const out = await captureStdout(() =>
      doctorCommand.action!(ctx({ json: true, fix: true, component: 'gitignore' })),
    );
    const payload = JSON.parse(out);
    expect(payload.fixes).toEqual([{ component: 'gitignore', outcome: 'applied' }]);
    expect(payload.results[0]).toMatchObject({ component: 'gitignore', status: 'pass' });
  }, 30000);

  it('marks hint-only fixes as manual', async () => {
    const out = await captureStdout(() =>
      doctorCommand.action!(ctx({ json: true, component: 'config' })),
    );
    const r = JSON.parse(out).results[0];
    expect(r.component).toBe('config');
    expect(r.fix_safety).toBe('manual');
    expect(r.fix_flag).toBeNull();
  }, 30000);
});
