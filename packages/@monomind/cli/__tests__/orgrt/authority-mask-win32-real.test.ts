/**
 * #852: the authority mask on native Windows, against the real thing: a real
 * PowerShell launcher, a real restricted token, real ACLs. Skipped everywhere
 * but win32 (and on a win32 host where the launcher cannot run).
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { authorityMaskArgs, maskedCommand } from '../../src/orgrt/authority-mask.js';
import { COMMON_MARKER, winMaskAvailability } from '../../src/orgrt/authority-mask-win32.js';
import { OrgBus } from '../../src/orgrt/bus.js';
import {
  assertHostPreflight,
  hostPreflight,
  setHostProbes,
} from '../../src/orgrt/documents/preflight.js';
import { roleExecMask } from '../../src/orgrt/exec-deny.js';
import { sectionsRaw } from './support/sections-defs.js';

const avail = process.platform === 'win32' ? winMaskAvailability() : { available: false };
const scratch = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));

/** Runs `node -e script` inside `mask` and returns what it printed. */
function inMask(mask: string[], script: string, ...argv: string[]) {
  const [cmd, args] = maskedCommand(mask, process.execPath, ['-e', script, ...argv]);
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000, windowsHide: true });
}
const READ = `try{process.stdout.write('READ:'+require('fs').readFileSync(process.argv[1],'utf8'))}catch(e){process.stdout.write('DENIED:'+e.code);process.exit(3)}`;
const WRITE = `try{require('fs').writeFileSync(process.argv[1],'x');process.stdout.write('WROTE')}catch(e){process.stdout.write('DENIED:'+e.code);process.exit(3)}`;

describe.runIf(avail.available)('the native Windows mask (real restricted token)', () => {
  function world() {
    const home = scratch('w32r-home-');
    const root = scratch('w32r-root-');
    const op = join(home, '.monomind', 'orgrt-operator');
    mkdirSync(op, { recursive: true });
    mkdirSync(join(home, '.monomind', 'dashboard-auth'), { recursive: true });
    mkdirSync(join(root, '.monomind'), { recursive: true });
    writeFileSync(join(op, 'acme.json'), 'OPERATOR');
    writeFileSync(join(home, '.monomind', 'dashboard-auth', 'secret'), 'HUMAN');
    writeFileSync(join(root, '.monomind', 'dashboard-token'), 'TOKEN');
    writeFileSync(join(root, 'plain.txt'), 'PLAIN');
    const env = {} as NodeJS.ProcessEnv;
    const mask = authorityMaskArgs({ home, env, roots: [root], orgRoot: root, platform: 'win32' });
    return { home, root, op, mask };
  }

  it('reports available, and a sections org starts, resumes and replaces a role by default', () => {
    expect(winMaskAvailability().available).toBe(true);
    setHostProbes(undefined);
    const def = sectionsRaw() as any;
    delete def.run_config.experimental;
    const r = hostPreflight(def);
    expect(r.refusals).toEqual([]);
    expect(r.ok).toBe(true);
    for (const what of ['start', 'resume', 'replace role boss']) {
      expect(() => assertHostPreflight(def, 'real', what)).not.toThrow();
    }
  });

  it('runs a program with its exit code, stdout and stdin intact', () => {
    const w = world();
    const [cmd, args] = maskedCommand(w.mask, process.execPath, [
      '-e',
      `process.stdin.on('data',d=>{process.stdout.write('got:'+String(d));process.exit(7)})`,
    ]);
    const r = spawnSync(cmd, args, { input: 'ping', encoding: 'utf8', timeout: 60_000 });
    expect(r.stdout).toBe('got:ping');
    expect(r.status).toBe(7);
  });

  it('makes the operator credentials, the dashboard secret and the token unreadable, not other files', () => {
    const w = world();
    expect(inMask(w.mask, READ, join(w.op, 'acme.json')).stdout).toBe('DENIED:EPERM');
    expect(inMask(w.mask, READ, join(w.home, '.monomind', 'dashboard-auth', 'secret')).stdout).toMatch(/^DENIED/);
    expect(inMask(w.mask, READ, join(w.root, '.monomind', 'dashboard-token')).stdout).toMatch(/^DENIED/);
    expect(inMask(w.mask, READ, join(w.root, 'plain.txt')).stdout).toBe('READ:PLAIN');
    expect(inMask(w.mask, WRITE, join(w.root, 'out.txt')).stdout).toBe('WROTE');
    // the daemon itself still reads them
    expect(readFileSync(join(w.op, 'acme.json'), 'utf8')).toBe('OPERATOR');
  });

  it('covers a file created in the hidden directory after the role started', () => {
    const w = world();
    const script = `const fs=require('fs');const p=process.argv[1];fs.writeFileSync(p,'late');process.stdout.write('made')`;
    // the role cannot create it ...
    expect(inMask(w.mask, script, join(w.op, 'new.json')).stdout).not.toBe('made');
    // ... and one the daemon creates later is unreadable to it
    writeFileSync(join(w.op, 'later.json'), 'LATE');
    expect(inMask(w.mask, READ, join(w.op, 'later.json')).stdout).toBe('DENIED:EPERM');
  });

  it('cannot take its own protection off, or replace the launcher', () => {
    const w = world();
    const strip = `const r=require('child_process').spawnSync('icacls',[process.argv[1],'/remove:d','*${COMMON_MARKER}']);process.stdout.write('exit='+r.status)`;
    inMask(w.mask, strip, w.op);
    const ps = `$a=Get-Acl -LiteralPath '${w.op}'; $a.SetAccessRuleProtection($true,$false); Set-Acl -LiteralPath '${w.op}' $a`;
    const [cmd, args] = maskedCommand(w.mask, 'powershell.exe', ['-NoProfile', '-Command', ps]);
    spawnSync(cmd, args, { encoding: 'utf8', timeout: 60_000 });
    expect(inMask(w.mask, READ, join(w.op, 'acme.json')).stdout).toBe('DENIED:EPERM');
    expect(inMask(w.mask, WRITE, w.mask[2]).stdout).toMatch(/^DENIED/);
  });

  it('keeps one role out of another role mail digest, the other role in, and the mail root read-only', () => {
    const w = world();
    const mail = join(w.root, 'mail');
    const a = join(mail, 'coder');
    const b = join(mail, 'reviewer');
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, 'digest.md'), 'CODER');
    writeFileSync(join(b, 'digest.md'), 'REVIEWER');
    const bus = new OrgBus('o', 'r', scratch('w32r-bus-'));
    const maskFor = (roleId: string, own: string, other: string) =>
      roleExecMask({
        bus,
        roleId,
        authorityMask: w.mask,
        bestEffortDenyRead: [other],
        bestEffortReadOnly: [mail],
        bestEffortBinds: [{ src: own, dest: own }],
        home: w.home,
        env: {},
      })!;
    const coder = maskFor('coder', a, b);
    expect(inMask(coder, READ, join(b, 'digest.md')).stdout).toBe('DENIED:EPERM');
    expect(inMask(coder, READ, join(a, 'digest.md')).stdout).toBe('READ:CODER');
    expect(inMask(coder, WRITE, join(a, 'note.md')).stdout).toBe('WROTE');
    expect(inMask(coder, WRITE, join(mail, 'root.md')).stdout).toMatch(/^DENIED/);
    expect(existsSync(join(mail, 'root.md'))).toBe(false);
    // the other role, masked the other way round, reads its own and not the coder's
    const reviewer = maskFor('reviewer', b, a);
    expect(inMask(reviewer, READ, join(b, 'digest.md')).stdout).toBe('READ:REVIEWER');
    expect(inMask(reviewer, READ, join(a, 'digest.md')).stdout).toBe('DENIED:EPERM');
  });
});
