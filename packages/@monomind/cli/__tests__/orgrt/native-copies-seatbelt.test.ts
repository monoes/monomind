// packages/@monomind/cli/__tests__/orgrt/native-copies-seatbelt.test.ts
/**
 * #768, GA row R5 on macOS: Seatbelt has no bind mounts, so a runtime that names its own
 * private directory (CODEX_HOME, PI_CODING_AGENT_DIR, HOME, ...) is isolated by rules over
 * the shared runner root instead: its own directory writable, the others' unreadable.
 * Claude's native directories cannot be redirected and stay audited.
 * The profile cases run anywhere; the end-to-end cases run the real sandbox-exec.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { maskedCommand } from '../../src/orgrt/authority-mask.js';
import { seatbeltAvailability } from '../../src/orgrt/authority-mask-seatbelt.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import { loadEnvelopeKey } from '../../src/orgrt/documents/envelope.js';
import { mailDirFor } from '../../src/orgrt/documents/mail-isolation.js';
import { hostPreflight } from '../../src/orgrt/documents/preflight.js';
import { sectionsRoleProtection } from '../../src/orgrt/documents/role-protection.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';
import { sectionsRaw } from './support/sections-defs.js';

const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const BASE = ['-p', '(version 1)\n(allow default)'];

function role(orgDir: string, roleId: string, runtime: string, home: string) {
  const def = sectionsRaw() as any;
  for (const r of def.roles) mkdirSync(mailDirFor(orgDir, r.id), { recursive: true });
  loadEnvelopeKey(orgDir);
  const p = sectionsRoleProtection({ def, orgDir, roleId, runtime, home, env: {} });
  const audits: string[] = [];
  const bus = new OrgBus('o', 'r', scratch('nc-bus-'));
  bus.subscribe((e) => e.type === 'audit' && audits.push(String(e.reason)));
  const mask = roleExecMask({
    bus,
    roleId,
    authorityMask: BASE,
    bestEffortDenyRead: p.bestEffortDenyRead,
    bestEffortReadOnly: p.bestEffortReadOnly,
    bestEffortBinds: p.bestEffortBinds,
    home,
    env: {},
  }) as string[];
  return { p, mask, audits };
}

const ownDir = (r: ReturnType<typeof role>): string =>
  r.p.runtimeEnv.CODEX_HOME ?? r.p.runtimeEnv.PI_CODING_AGENT_DIR ?? r.p.runtimeEnv.HOME;

function world() {
  const orgDir = join(scratch('nc-root-'), '.monomind/orgs/sec-org');
  mkdirSync(orgDir, { recursive: true });
  return { orgDir, home: scratch('nc-home-') };
}

describe('native copies on a Seatbelt mask (any host)', () => {
  it('a runtime with its own directory keeps it writable in the read-only runner root, unaudited', () => {
    const w = world();
    const coder = role(w.orgDir, 'coder', 'codex', w.home);
    const own = ownDir(coder);
    expect(own.startsWith(join(w.orgDir, 'runner', 'coder'))).toBe(true);
    const profile = coder.mask[1];
    expect(profile).toContain(`(deny file-write* (subpath "${join(w.orgDir, 'runner')}"))`);
    expect(profile).toContain(`(deny file-read* (subpath "${join(w.orgDir, 'runner', 'boss')}"))`);
    expect(profile).not.toContain(
      `(deny file-read* (subpath "${join(w.orgDir, 'runner', 'coder')}"))`,
    );
    expect(profile.lastIndexOf('(allow file-write*')).toBeGreaterThan(
      profile.lastIndexOf('(deny file-write*'),
    );
    expect(profile).toContain(`(allow file-write* (subpath "${own}"))`);
    expect(coder.audits).not.toContain('native-copies-unprotected');
  });

  it('Claude, which cannot be redirected, is still audited as unprotected', () => {
    const w = world();
    mkdirSync(join(w.home, '.claude/projects'), { recursive: true });
    const coder = role(w.orgDir, 'coder', 'claude', w.home);
    expect(coder.audits).toContain('native-copies-unprotected');
  });

  it('preflight names only the runtimes that remain unprotected', () => {
    const ok = { available: true };
    const warn = (runtime: string) => {
      const def = sectionsRaw() as any;
      delete def.run_config.experimental;
      def.runtime = runtime;
      return hostPreflight(def, { mask: ok, sandbox: ok }, 'darwin').warnings.join('\n');
    };
    expect(warn('claude')).toMatch(/Seatbelt mask cannot give .* for the claude runtime/);
    expect(warn('codex')).not.toMatch(/Seatbelt/);
  });
});

describe.runIf(process.platform === 'darwin' && seatbeltAvailability().available)(
  'native copies on a Seatbelt mask (real sandbox-exec)',
  () => {
    const run = (mask: string[], script: string) => {
      const [cmd, argv] = maskedCommand(mask, '/bin/bash', ['-c', script]);
      return spawnSync(cmd, argv, { encoding: 'utf8' });
    };

    it.each(['codex', 'pi', 'antigravity'])(
      '%s: the role writes its private directory; another role sees none of it',
      (runtime) => {
        const w = world();
        const coder = role(w.orgDir, 'coder', runtime, w.home);
        const boss = role(w.orgDir, 'boss', runtime, w.home);
        const own = ownDir(coder);
        expect(
          run(coder.mask, `echo transcript > ${own}/own.jsonl && cat ${own}/own.jsonl`).stdout,
        ).toBe('transcript\n');
        expect(run(boss.mask, `cat ${own}/own.jsonl`).stdout).not.toContain('transcript');
        expect(run(boss.mask, `ls ${own}`).stdout).not.toContain('own.jsonl');
        run(boss.mask, `echo forged > ${own}/forged.jsonl`);
        expect(existsSync(join(own, 'forged.jsonl'))).toBe(false);
        // the runner root itself stays read-only
        expect(run(coder.mask, `mkdir ${w.orgDir}/runner/new-dir`).status).not.toBe(0);
        expect(existsSync(join(w.orgDir, 'runner', 'new-dir'))).toBe(false);
      },
    );

    it("a role cannot overwrite or remove another role's existing file", () => {
      const w = world();
      const coder = role(w.orgDir, 'coder', 'codex', w.home);
      const boss = role(w.orgDir, 'boss', 'codex', w.home);
      const file = join(ownDir(coder), 'state.sqlite');
      writeFileSync(file, 'ORIGINAL');
      run(boss.mask, `echo forged > ${file}; rm -f ${file}`);
      expect(readFileSync(file, 'utf8')).toBe('ORIGINAL');
    });
  },
);
