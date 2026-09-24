import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { doctorCommand } from '../commands/doctor.js';
import { doctorJsonPayload } from '../commands/doctor-json.js';
import { CLI } from '../index.js';
import { OBSOLETE_HELPER_NAMES } from '../init/helpers-generator.js';
import { output } from '../output.js';
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
    expect(payload.summary).toEqual({ passed: 0, warnings: 1, failed: 0, info: 0, skipped: 0 });
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

  it('marks an orphaned-hook helpers warning manual: --fix does not remove them', async () => {
    mkdirSync(join(dir, '.claude', 'helpers'), { recursive: true });
    writeFileSync(join(dir, '.claude', 'helpers', OBSOLETE_HELPER_NAMES[0]), '');
    const out = await captureStdout(() =>
      doctorCommand.action!(ctx({ json: true, component: 'helpers' })),
    );
    expect(JSON.parse(out).results[0]).toMatchObject({
      component: 'helpers',
      status: 'warn',
      fix_safety: 'manual',
      fix_flag: null,
    });
  }, 30000);

  it('reports an unknown component as an error in the payload', async () => {
    const out = await captureStdout(() =>
      doctorCommand.action!(ctx({ json: true, component: 'bogus' })),
    );
    const payload = JSON.parse(out);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe('unknown component "bogus"');
    expect(payload.results).toEqual([]);
  }, 30000);

  it('-v --json keeps stdout to the one document', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`process.exit: ${code}`);
    }) as never);
    const verbosity = output.getVerbosity();
    try {
      const out = await captureStdout(() =>
        new CLI({ interactive: false }).run([
          'doctor',
          '-c',
          'node',
          '-v',
          '--json',
          '--no-update',
        ]),
      );
      expect(JSON.parse(out).results[0]).toMatchObject({ component: 'node' });
    } finally {
      output.setVerbosity(verbosity);
      exit.mockRestore();
    }
  }, 30000);
});

describe('doctorJsonPayload fix safety', () => {
  const payloadFor = (results: object[]) =>
    doctorJsonPayload(ctx({}), { success: true, data: { results } }).results;

  it("takes a result's own fix safety over its component's", () => {
    const [stale, orphaned] = payloadFor([
      {
        component: 'helpers',
        name: 'Helper Files',
        status: 'warn',
        message: 'stale',
        fix: 'x',
        fixSafety: 'auto',
      },
      {
        component: 'helpers',
        name: 'Helper Files',
        status: 'warn',
        message: 'orphaned',
        fix: 'x',
        fixSafety: 'manual',
      },
    ]);
    expect(stale).toMatchObject({ fix_safety: 'auto', fix_flag: '--fix' });
    expect(orphaned).toMatchObject({ fix_safety: 'manual', fix_flag: null });
  });

  it('marks the monoes-tools fix (brew, curl, sudo) as confirm', () => {
    const [r] = payloadFor([
      {
        component: 'monoes-tools',
        name: 'monoes Tools',
        status: 'warn',
        message: 'm',
        fix: 'brew tap',
      },
    ]);
    expect(r).toMatchObject({ fix_safety: 'confirm', fix_flag: '--fix' });
  });
});
