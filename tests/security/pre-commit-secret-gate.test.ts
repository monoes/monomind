/**
 * Guards `.githooks/pre-commit` — the staged-content secret scanner.
 *
 * WHY THIS EXISTS
 * ---------------
 * The gate's three generic rules (`api_key=`, `secret|password=`, `token|bearer=`)
 * matched any 8-10+ character run after the name, with no notion of what a
 * literal secret looks like. A query string that puts the parameter name, an
 * `=` and a template interpolation next to each other read as a credential and
 * blocked the commit. That shape is everywhere in src/ui/routes-monoes.mjs's
 * OAuth URLs.
 *
 * A false positive here is not a harmless annoyance. The documented way past
 * the gate is `SKIP_PRE_COMMIT=1`, which disables EVERY rule in the file, not
 * just the one that misfired. So each rule that cries wolf raises the odds
 * that the next real secret walks through a gate someone has learned to
 * switch off. That is the asymmetry these cases pin down: the true positives
 * must keep blocking, and the code-shaped values must not.
 *
 * The hook is a bash wrapper around an inline node heredoc, so it cannot be
 * imported. These tests run the real file against a throwaway git repo, which
 * also covers the wrapper's exit-code plumbing.
 *
 * FIXTURES ARE CONCATENATED ON PURPOSE
 * ------------------------------------
 * Every fixture below is assembled from pieces so that no credential shape —
 * and no false-positive shape either — appears contiguously in this file's own
 * source. Written out whole, they trip the very gates under test (and the
 * .claude pre-write gate) while this file is being saved. Same reasoning as
 * the split literals in packages/@monomind/cli/src/__tests__/redaction-secret-shapes.test.ts.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const HOOK = fileURLToPath(new URL('../../.githooks/pre-commit', import.meta.url));

const EQ = '=';
const OPEN = '${';

/** Stages `content` as a new file in a throwaway repo and runs the real hook.
 *  Returns the hook's exit status: 0 = commit allowed, 1 = blocked. */
function runGate(content: string, filename = 'sample.ts'): { status: number; output: string } {
  const dir = mkdtempSync(join(tmpdir(), 'secret-gate-'));
  try {
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(join(dir, filename), content);
    git('add', filename);

    const res = spawnSync('bash', [HOOK], {
      cwd: dir,
      encoding: 'utf-8',
      env: { ...process.env, SKIP_PRE_COMMIT: '' },
    });
    return { status: res.status ?? -1, output: `${res.stdout ?? ''}${res.stderr ?? ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('pre-commit secret gate — still blocks real secrets', () => {
  it('blocks a generic quoted token literal', () => {
    expect(runGate(`const t = { token${EQ} "a1b2c3d4e5f6g7h8i9j0" };`).status).toBe(1);
  });

  it('blocks a generic password literal', () => {
    expect(runGate(`const p = "password${EQ}hunter2hunter2";`).status).toBe(1);
  });

  it('blocks a GitHub personal access token', () => {
    const ghp = `ghp_${'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'}`;
    expect(runGate(`const t = "${ghp}";`).status).toBe(1);
  });

  it('blocks an api_key assignment', () => {
    expect(runGate(`api_key ${EQ} "9f8e7d6c5b4a3210ffee"`).status).toBe(1);
  });

  it('reports the offending path and a preview when it blocks', () => {
    const { output } = runGate(`const t = { token${EQ} "a1b2c3d4e5f6g7h8i9j0" };`, 'leaky.ts');
    expect(output).toContain('leaky.ts');
    expect(output).toContain('COMMIT BLOCKED');
  });
});

describe('pre-commit secret gate — does not block code-shaped values', () => {
  it('allows a template interpolation in a query string (the reported false positive)', () => {
    const line = `const url = \`https://api.example.com/v1?token${EQ}${OPEN}apiToken}&limit=50\`;`;
    expect(runGate(line).status).toBe(0);
  });

  it('allows a value read from the environment through an interpolation', () => {
    const line = `const u = \`/callback?token${EQ}${OPEN}process.env.MONOES_TOKEN}\`;`;
    expect(runGate(line).status).toBe(0);
  });

  it('allows a bare process.env read', () => {
    const line = `const apiKey ${EQ} process.env.SOME_SERVICE_API_KEY;`;
    expect(runGate(line).status).toBe(0);
  });

  it('allows a documentation placeholder', () => {
    // Uses the `name=<placeholder>` form deliberately: the prose form
    // ("Authorization: Bearer <your-token>") never matched the rule in the
    // first place, so it would not exercise the placeholder branch at all.
    const line = `curl "https://api.example.com/v1?token${EQ}<your-api-token-here>"\n`;
    expect(runGate(line, 'README.md').status).toBe(0);
  });

  it('allows prose describing the pattern, so the gate can be documented', () => {
    const line = `The gate used to false-positive on token${EQ}${OPEN}...} inside a query string.\n`;
    expect(runGate(line, 'notes.md').status).toBe(0);
  });
});
