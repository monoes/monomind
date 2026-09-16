/**
 * `monomind status`'s System Resources section always printed
 * "Resource governor not available", even though checkResources() itself
 * worked fine. The bare catch swallowed a real TypeError: displayStatus()
 * assigned an unbound method reference — `output.warning` / `output.error` /
 * `output.success` — to `memColor` and called it later as `memColor(text)`.
 * Those are ordinary prototype methods that read `this.colorEnabled` via
 * `this.color()`, so calling one without its receiver throws "Cannot read
 * properties of undefined (reading 'color')". Since freeMemPct is normally
 * in the 15-30% "warning" band or above, this fired on every real machine.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'bin', 'cli.js');

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), 'status-resgov-'));
  // The minimal marker status.ts's isInitialized() checks for.
  mkdirSync(join(projectDir, '.monomind'), { recursive: true });
  writeFileSync(join(projectDir, '.monomind', 'config.yaml'), 'test: true\n');
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

function runStatus(): { out: string; code: number | null } {
  const res = spawnSync(process.execPath, [CLI, 'status'], {
    cwd: projectDir,
    encoding: 'utf-8',
    timeout: 30_000,
    env: { ...process.env, CLAUDE_PROJECT_DIR: projectDir, MONOMIND_DISABLE_UPDATE_CHECK: '1' },
  });
  return { out: `${res.stdout ?? ''}${res.stderr ?? ''}`, code: res.status };
}

describe('status System Resources section', () => {
  it('renders the real resource table instead of swallowing a TypeError', () => {
    const { out, code } = runStatus();
    expect(code).toBe(0);
    expect(out).toContain('System Resources');
    expect(out).toContain('Available RAM');
    expect(out).toContain('SDK Processes');
    expect(out).not.toContain('Resource governor not available');
  });
});
