// packages/@monomind/cli/__tests__/orgrt/documents/copy-inventory.test.ts
// GA row R5 (spec 9.3; 6.1 copy inventory): where each runner keeps native
// transcripts, file backups and debug logs, and a per-role private mount over
// them so no role reads another's. A runner without an inventory entry is
// refused for sections orgs outside the eval harness.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OrgBus } from '../../../src/orgrt/bus.js';
import { OrgDaemon } from '../../../src/orgrt/daemon.js';
import {
  claudeNativeDirs,
  copyInventoryFindings,
  nativeBinds,
  privateRunnerRoot,
  runtimeDirFor,
} from '../../../src/orgrt/documents/copy-inventory.js';
import { authorityMaskAvailability } from '../../../src/orgrt/authority-mask.js';
import { roleExecMask } from '../../../src/orgrt/exec-deny.js';
import { sectionsRaw } from '../support/sections-defs.js';

let base: string;
const busDirs: string[] = [];
const busDir = (): string => {
  const d = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'inv-bus-'));
  busDirs.push(d);
  return d;
};
beforeEach(() => {
  base = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'inv-'));
});
afterEach(() => {
  rmSync(base, { recursive: true, force: true });
  for (const d of busDirs.splice(0)) {
    try {
      rmSync(d, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } catch {
      /* still being written */
    }
  }
});

describe('claudeNativeDirs', () => {
  it('lists the transcript, backup and debug directories of the config dir', () => {
    expect(claudeNativeDirs('/h', {})).toEqual(['/h/.claude/projects', '/h/.claude/file-history', '/h/.claude/debug']);
    expect(claudeNativeDirs('/h', { CLAUDE_CONFIG_DIR: '/cfg' })).toEqual(['/cfg/projects', '/cfg/file-history', '/cfg/debug']);
  });
});

describe('nativeBinds', () => {
  const def = () => sectionsRaw() as any;
  it('gives a Claude role in a sections org one private source per native directory', () => {
    const binds = nativeBinds(def(), '/o', 'coder', 'claude', '/h', {});
    expect(binds).toEqual([
      { src: join(privateRunnerRoot('/o', 'coder'), 'projects'), dest: '/h/.claude/projects' },
      { src: join(privateRunnerRoot('/o', 'coder'), 'file-history'), dest: '/h/.claude/file-history' },
      { src: join(privateRunnerRoot('/o', 'coder'), 'debug'), dest: '/h/.claude/debug' },
    ]);
    expect(nativeBinds(def(), '/o', 'boss', 'claude', '/h', {})[0].src).not.toBe(binds[0].src);
  });
  it('gives nothing for an org without sections or a runtime without a private directory', () => {
    const legacy = { name: 'l', goal: 'g', roles: def().roles };
    expect(nativeBinds(legacy as any, '/o', 'coder', 'claude', '/h', {})).toEqual([]);
    expect(nativeBinds(legacy as any, '/o', 'coder', 'codex', '/h', {})).toEqual([]);
    expect(nativeBinds(def(), '/o', 'coder', 'no-such-runtime', '/h', {})).toEqual([]);
  });
  it('binds the private directory of a codex, pi or antigravity role over itself, one per role', () => {
    for (const rt of ['codex', 'pi', 'pi-rpc', 'antigravity', 'opencode', 'crush']) {
      const own = runtimeDirFor('/o', 'coder', rt);
      expect(nativeBinds(def(), '/o', 'coder', rt, '/h', {})).toEqual([{ src: own, dest: own }]);
      expect(runtimeDirFor('/o', 'boss', rt)).not.toBe(own);
    }
    expect(runtimeDirFor('/o', 'coder', 'codex')).toBe(join(privateRunnerRoot('/o', 'coder'), 'rt-codex'));
  });
});

describe('copyInventoryFindings', () => {
  const withRuntime = (runtime: string, evalMode: boolean) => {
    const d = sectionsRaw() as any;
    d.roles.find((r: any) => r.id === 'coder').runtime = runtime;
    if (!evalMode) delete d.run_config.experimental;
    return d;
  };
  it('is silent when every role runs a runtime with an inventory entry', () => {
    expect(copyInventoryFindings(sectionsRaw() as any)).toEqual({ errors: [], warnings: [] });
  });
  it('warns, naming role and runtime, for an unlisted runtime in an eval org', () => {
    const f = copyInventoryFindings(withRuntime('no-such-runtime', true));
    expect(f.errors).toEqual([]);
    expect(f.warnings.join()).toMatch(/coder.*no-such-runtime.*native copies/);
  });
  it('refuses an unlisted runtime outside the eval harness', () => {
    const f = copyInventoryFindings(withRuntime('no-such-runtime', false));
    expect(f.errors.join()).toMatch(/coder.*no-such-runtime.*no copy-inventory entry/);
  });
  it('accepts every verified runtime silently, in and outside the eval harness', () => {
    for (const rt of ['claude', 'codex', 'antigravity', 'opencode', 'pi', 'pi-rpc', 'crush', 'grok', 'copilot', 'hermes'])
      for (const evalMode of [true, false])
        expect(copyInventoryFindings(withRuntime(rt, evalMode)), `${rt} ${evalMode}`).toEqual({ errors: [], warnings: [] });
  });
  it('accepts an unverified runtime with a warning, never an error', () => {
    for (const rt of ['qwen', 'qwen-rpc', 'kimicode', 'cline', 'aider', 'dsh', 'vercel']) {
      const f = copyInventoryFindings(withRuntime(rt, false));
      expect(f.errors, rt).toEqual([]);
      expect(f.warnings.join(), rt).toMatch(new RegExp(`coder.*${rt}.*not probed`));
    }
  });
  it('refuses a refused runtime outside the eval harness and warns inside it, naming the reason', () => {
    const env = { OPENCODE_URL: 'http://127.0.0.1:4096' };
    const out = copyInventoryFindings(withRuntime('opencode', false), env);
    expect(out.errors.join()).toMatch(/coder.*opencode.*refused.*OPENCODE_URL/);
    const inEval = copyInventoryFindings(withRuntime('opencode', true), env);
    expect(inEval.errors).toEqual([]);
    expect(inEval.warnings.join()).toMatch(/coder.*opencode.*refused.*OPENCODE_URL/);
  });
  it('kilo (full access only, refused in a sections org) and freebuff (no transport) fail validate with the reason, a warning in eval', () => {
    for (const [rt, why] of [['kilo', /full access/i], ['freebuff', /no headless/i]] as const) {
      const out = copyInventoryFindings(withRuntime(rt, false));
      expect(out.errors.join(), rt).toMatch(new RegExp(`coder.*${rt}.*refused`));
      expect(out.errors.join(), rt).toMatch(why);
      const inEval = copyInventoryFindings(withRuntime(rt, true));
      expect(inEval.errors, rt).toEqual([]);
      expect(inEval.warnings.join(), rt).toMatch(new RegExp(`coder.*${rt}.*refused`));
    }
  });
  it('an endpoint role is exempt (it runs no agent)', () => {
    const d = sectionsRaw() as any;
    d.roles.push({ id: 'hook', title: 'Hook', type: 'specialist', reports_to: 'boss', kind: 'endpoint', runtime: 'codex' });
    expect(copyInventoryFindings(d).warnings).toEqual([]);
  });
});

describe('the authority mask layer', () => {
  const mk = (available: boolean, binds: { src: string; dest: string }[]) => {
    const bus = new OrgBus('o', 'r', busDir());
    const events: any[] = [];
    bus.subscribe((e) => events.push(e));
    const mask = roleExecMask({
      bus,
      roleId: 'coder',
      authorityMask: ['--dev-bind', '/', '/'],
      bestEffortBinds: binds,
      home: join(base, 'home'),
      env: {},
      availability: { available, reason: 'no bwrap here' },
    } as any);
    return { mask, events };
  };
  const dirs = () => {
    const src = join(base, 'private/projects');
    const dest = join(base, 'cfg/projects');
    mkdirSync(src, { recursive: true });
    mkdirSync(dest, { recursive: true });
    return { src, dest };
  };

  it('binds each private source over its destination when bubblewrap works', () => {
    const b = dirs();
    expect(mk(true, [b]).mask).toEqual(expect.arrayContaining(['--bind', b.src, b.dest]));
  });
  it('keeps starting with an audit when it does not', () => {
    const { mask, events } = mk(false, [dirs()]);
    expect(mask).toEqual(['--dev-bind', '/', '/']);
    expect(events.some((e) => e.type === 'audit' && e.reason === 'native-copies-unprotected')).toBe(true);
  });
  it('skips a destination that does not exist', () => {
    const src = join(base, 'private/p');
    mkdirSync(src, { recursive: true });
    expect(mk(true, [{ src, dest: join(base, 'nope') }]).mask).not.toContain('--bind');
  });

  const real = authorityMaskAvailability();
  it.skipIf(!real.available)('with a real bubblewrap: a role writes into its private source and the real directory stays empty', () => {
    const b = dirs();
    const bus = new OrgBus('o', 'r', busDir());
    const mask = roleExecMask({
      bus,
      roleId: 'coder',
      authorityMask: ['--dev-bind', '/', '/'],
      bestEffortBinds: [b],
      home: join(base, 'home'),
      env: {},
    } as any) as string[];
    writeFileSync(join(b.dest, 'host-copy.jsonl'), 'operator transcript');
    const r = spawnSync('bwrap', [...mask, '--', 'sh', '-c', `ls ${b.dest}; echo mine > ${b.dest}/own.jsonl`], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('host-copy.jsonl');
    expect(readdirSync(b.src)).toEqual(['own.jsonl']);
    expect(existsSync(join(b.dest, 'own.jsonl'))).toBe(false);
  });
});

describe('a sections session (real daemon)', () => {
  it('denies every role reading the private runner roots', async () => {
    const root = join(base, 'proj');
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/sec-org.json'), JSON.stringify(sectionsRaw()));
    const seen: any[] = [];
    const queryFn = ({ prompt, options }: any) =>
      (async function* () {
        seen.push(options);
        for await (const m of prompt) {
          yield { type: 'assistant', message: { content: [{ type: 'text', text: `echo: ${m.message.content}` }] } };
          yield { type: 'result', subtype: 'success', usage: { input_tokens: 1, output_tokens: 1 } };
        }
      })();
    const d = new OrgDaemon(root, { queryFn: queryFn as any, forward: false, stopWaitMs: 100, bossRestartBackoffMs: [600_000] });
    try {
      await d.startOrg('sec-org', undefined, { evalGate: true });
      for (let i = 0; i < 200 && seen.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
      const runner = join(root, '.monomind/orgs/sec-org/runner');
      expect(seen[0].disallowedTools).toContain(`Read(/${runner}/**)`);
    } finally {
      await d.stopAll().catch(() => {});
    }
  });
});
