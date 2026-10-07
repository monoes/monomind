// #655: an old and a new command form of one hook are one hook.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkTokenCostSettings } from '../../src/commands/doctor-cost-checks.js';
import { hookIdentity, hookKey } from '../../src/init/hook-identity.js';
import { DEFAULT_INIT_OPTIONS } from '../../src/init/types.js';
import { writeSettings } from '../../src/init/write-settings.js';

const OLD = `sh -c 'p="$CLAUDE_PROJECT_DIR"; exec node "$p/.claude/helpers/hook-handler.cjs" pre-bash'`;
const NEW = `node "$(p="$PWD"; echo $p)/.claude/helpers/hook-handler.cjs" pre-bash`;
const tmp = () => mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'dedupe-'));

describe('hookIdentity', () => {
  it('ignores the wrapper, keeps helper and argument', () => {
    expect(hookIdentity(OLD)).toBe('hook-handler.cjs pre-bash');
    expect(hookIdentity(NEW)).toBe('hook-handler.cjs pre-bash');
    expect(hookIdentity('node x.cjs a')).toBe('node x.cjs a');
    expect(hookKey('PreToolUse', 'Bash', OLD)).not.toBe(hookKey('PreToolUse', 'Grep', OLD));
  });
});

describe('doctor', () => {
  it('flags old and new forms of one hook inside a single file', async () => {
    const proj = tmp();
    mkdirSync(join(proj, '.claude'));
    writeFileSync(
      join(proj, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ command: OLD }, { command: NEW }] }] } }),
    );
    const r = await checkTokenCostSettings(proj);
    expect(r.message).toContain('hook-handler.cjs pre-bash registered twice');
  });
});

describe('init --force', () => {
  it('replaces an older command form instead of running both, and keeps user hooks', async () => {
    const dir = tmp();
    mkdirSync(join(dir, '.claude'));
    const user = 'node ./my-own-hook.js';
    writeFileSync(
      join(dir, '.claude', 'settings.json'),
      JSON.stringify({ hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: OLD }, { type: 'command', command: user }] }] } }),
    );
    await writeSettings(dir, { ...DEFAULT_INIT_OPTIONS, force: true }, { created: { files: [] }, skipped: [] } as any);
    const hooks = JSON.parse(readFileSync(join(dir, '.claude', 'settings.json'), 'utf8')).hooks.PreToolUse;
    const cmds: string[] = hooks.filter((g: any) => g.matcher === 'Bash').flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(cmds).toContain(user);
    expect(cmds).not.toContain(OLD);
    expect(cmds.filter((c) => hookIdentity(c) === 'hook-handler.cjs pre-bash')).toHaveLength(1);
  });
});
