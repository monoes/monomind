/**
 * Non-fatal problems init records (a SKILLS_MAP entry with no source
 * directory, a skill it could not retire, an unparseable .mcp.json it left
 * alone) go to result.errors. The command printed them only when the whole run
 * failed, so on a successful run they were silently dropped.
 */

import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InitResult } from '../src/init/types.js';
import { output } from '../src/output.js';
import type { CommandContext } from '../src/types.js';

output.setVerbosity('quiet');

vi.mock('child_process', () => {
  const fail = () => {
    throw new Error('mocked: no real process execution in tests');
  };
  return {
    execSync: vi.fn(fail),
    execFileSync: vi.fn(fail),
    exec: vi.fn(fail),
    execFile: vi.fn(fail),
    spawn: vi.fn(() => {
      const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
      proc.unref = () => {};
      proc.kill = () => {};
      return proc;
    }),
  };
});

vi.mock('../src/init/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/init/index.js')>();
  return {
    ...actual,
    executeInit: vi.fn(
      async (): Promise<InitResult> => ({
        success: true,
        platform: actual.detectPlatform(),
        created: { directories: [], files: [] },
        updated: [],
        skipped: [],
        removed: [],
        errors: ["Skill 'ghost' listed in SKILLS_MAP has no source directory — skipped"],
        summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
      }),
    ),
  };
});

describe('init prints recorded errors on a successful run', () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-init-errors-'));
  });
  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('shows each error as a warning', async () => {
    const warnings: string[] = [];
    vi.spyOn(output, 'printWarning').mockImplementation((msg: string) => {
      warnings.push(msg);
    });
    const { initCommand } = await import('../src/commands/init.js');

    const result = await initCommand.action!({
      args: [],
      flags: { _: [], 'no-watch': true, 'no-start-all': true, 'no-memory': true },
      cwd: tmpDir,
      interactive: false,
    } as CommandContext);

    expect(result.success).toBe(true);
    expect(warnings.join('\n')).toContain("Skill 'ghost' listed in SKILLS_MAP has no source directory");
  }, 60000);
});
