import { execFileSync, spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AgentRunArgs } from '../../src/orgrt/agent-runner.js';
import { launchCline } from '../../src/orgrt/cline-runner-proc.js';
import { HermesAgentRunner } from '../../src/orgrt/hermes-runner.js';
import { KimiCodeAgentRunner } from '../../src/orgrt/kimicode-runner.js';
import { createRunnerInputDir, writeRunnerInput } from '../../src/orgrt/runner-inputs.js';
import { ensureOperatorProtectedPaths, operatorProtectedPaths, monomindMaskLayout } from '../../src/orgrt/operator-protected-paths.js';
import { prepareGitGuard } from '../../src/orgrt/git-guard.js';
import { buildClaudeRestrictions } from '../../src/orgrt/role-sandbox.js';
import { fakeHost } from './cline/fake-cline.js';

const state = vi.hoisted(() => ({ home: '' }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: () => state.home || actual.homedir() };
});
vi.mock('../../src/orgrt/runner-inputs.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orgrt/runner-inputs.js')>();
  return { ...actual, writeRunnerInput: vi.fn(actual.writeRunnerInput) };
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync), spawn: vi.fn(actual.spawn) };
});
let root: string;
let mainHome: string;
let work: string;
let bin: string;
let log: string;
beforeAll(() => {
  root = fs.mkdtempSync(path.join(path.dirname(process.cwd()), '.runner-input-test-'));
  state.home = mainHome = path.join(root, 'home');
  fs.mkdirSync(state.home);
  work = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-input-work-'));
  bin = path.join(work, 'fake-cli.cjs');
  log = path.join(work, 'input.json');
  fs.writeFileSync(bin, `#!/usr/bin/env node
const fs = require('fs');
const argv = process.argv.slice(2);
if (argv.includes('--help')) { console.log('--query-file PATH --oneshot'); process.exit(0); }
const kind = process.env.TEST_RUNNER;
const idx = argv.indexOf(kind === 'hermes' ? '--query-file' : '--agent-file');
const file = kind === 'cline' ? fs.readlinkSync('/proc/self/fd/0') : argv[idx + 1];
const input = kind === 'cline' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(file, 'utf8');
fs.writeFileSync(process.env.TEST_LOG, JSON.stringify({ file, input, mode: fs.statSync(file).mode & 511 }));
if (kind === 'kimi') console.log(JSON.stringify({ role: 'assistant', content: 'done' }));
else console.log('done');
`);
  fs.chmodSync(bin, 0o755);
});
afterEach(() => { state.home = mainHome; vi.unstubAllEnvs(); vi.restoreAllMocks(); });
afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});
function args(kind: string): AgentRunArgs {
  return { tools: [], prompt: (async function* () { yield 'task'; })(), systemPrompt: 'PRIVATE SYSTEM', cwd: work, maxTurns: 5, env: { TEST_RUNNER: kind, TEST_LOG: log } };
}
function checkInput() {
  const record = JSON.parse(fs.readFileSync(log, 'utf8'));
  expect(record.input).toContain('PRIVATE SYSTEM');
  expect(record.file.startsWith(path.join(state.home, '.monomind', 'runner-inputs') + path.sep)).toBe(true);
  expect(record.mode).toBe(0o600);
  expect(fs.existsSync(record.file)).toBe(false);
}
describe.runIf(process.platform !== 'win32')('private runner input delivery (#599)', () => {
  it('keeps Hermes query files outside sandbox writable temp roots', async () => {
    for await (const _ of new HermesAgentRunner(bin).run(args('hermes'))) {}
    checkInput();
  });
  it('keeps Kimi agent files outside sandbox writable temp roots', async () => {
    for await (const _ of new KimiCodeAgentRunner(bin).run(args('kimi'))) {}
    checkInput();
  });
  it.runIf(process.platform === 'linux')('feeds Cline through a protected FIFO with a read-only authority mask', async (context) => {
    const probe = spawnSync('bwrap', ['--ro-bind', '/', '/', '--', '/bin/true']);
    if (probe.status !== 0) context.skip();
    const runArgs = args('cline');
    runArgs.authorityMask = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', os.tmpdir(), os.tmpdir(), '--bind', work, work];
    const launch = launchCline({ bin, env: { ...process.env, ...runArgs.env } as Record<string, string>, configArgs: [], dataDirArgs: [], dataDir: work, scoped: true }, [], runArgs, fakeHost(), { stdinPrompt: 'PRIVATE SYSTEM\n\ntask' });
    try { expect(await launch.exit, launch.stderr()).toBe(0); } finally { launch.dispose(); }
    checkInput();
  });
});


describe('runner input storage boundaries (#599)', () => {
  it.each([false, true])('denies future input files before a Claude SDK role starts (override=%s)', (override) => {
    const home = path.join(root, `sdk-home-${override}`);
    fs.mkdirSync(home);
    state.home = home;
    const mmHome = override ? path.join(root, 'sdk-custom-home') : path.join(home, '.monomind');
    const env = override ? { MONOMIND_HOME: mmHome } : {};
    if (override) vi.stubEnv('MONOMIND_HOME', mmHome);
    const ctx = { home, env, cwd: work, tmp: os.tmpdir(), platform: 'linux' as const };
    const inputRoot = path.join(mmHome, 'runner-inputs');
    expect(fs.existsSync(inputRoot)).toBe(false);
    expect(operatorProtectedPaths(ctx)).toContain(inputRoot);
    ensureOperatorProtectedPaths(ctx);
    const guard = prepareGitGuard({ level: 'read', stateDir: path.join(work, `guard-${override}`), protectedGitDirs: [] })!;
    const restrictions = buildClaudeRestrictions(guard, undefined, ctx, true).sandbox as { filesystem: { denyWrite: string[] } };
    expect(restrictions.filesystem.denyWrite).toContain(inputRoot);
    const dir = createRunnerInputDir('kimi', args('kimi'));
    writeRunnerInput(path.join(dir, 'agent.md'), 'created after the sandbox policy snapshot');
    expect(dir.startsWith(inputRoot + path.sep)).toBe(true);
    fs.rmSync(dir, { recursive: true });
  });

  it('stays read-only in the monomind authority layout', () => {
    const dir = createRunnerInputDir('kimi', args('kimi'));
    if (process.platform !== 'win32') expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
    const layout = monomindMaskLayout(state.home, {});
    expect(layout.readOnly).toContain(path.join(state.home, '.monomind'));
    expect(layout.writable.some((p) => dir.startsWith(p + path.sep))).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
  it.each(['workspace', 'temp', 'TMPDIR', 'TMP', 'TEMP'])('rejects a root covered by %s before writing', (kind) => {
    const base = path.join(root, `unsafe-${kind}`);
    const runArgs = args('kimi');
    if (kind === 'temp') vi.stubEnv('MONOMIND_HOME', path.join(os.tmpdir(), 'must-not-create-599'));
    else {
      vi.stubEnv('MONOMIND_HOME', base);
      if (kind === 'workspace') runArgs.cwd = root;
      else runArgs.env[kind] = root;
    }
    expect(() => createRunnerInputDir('kimi', runArgs)).toThrow(/outside the workspace/);
    expect(fs.existsSync(base)).toBe(false);
  });
  it('rejects HOME in a writable temp root', () => {
    state.home = work;
    expect(() => createRunnerInputDir('hermes', { ...args('hermes'), cwd: root })).toThrow(/outside the workspace/);
  });
  it.runIf(process.platform !== 'win32')('rejects symlink ancestors without following them', () => {
    const link = path.join(root, 'redirect');
    fs.symlinkSync(state.home, link, 'dir');
    vi.stubEnv('MONOMIND_HOME', path.join(link, '.monomind'));
    expect(() => createRunnerInputDir('kimi', args('kimi'))).toThrow(/symlink/);
  });
  it.runIf(process.platform !== 'win32')('does not overwrite a symlink substituted for an input file', () => {
    const dir = createRunnerInputDir('kimi', args('kimi'));
    const victim = path.join(work, 'victim.txt');
    fs.writeFileSync(victim, 'original');
    const input = path.join(dir, 'agent.md');
    fs.symlinkSync(victim, input);
    expect(() => writeRunnerInput(input, 'replacement')).toThrow();
    expect(fs.readFileSync(victim, 'utf8')).toBe('original');
    fs.rmSync(dir, { recursive: true });
  });
  it('does not interpret Windows directory mode bits as POSIX write grants', () => {
    const base = path.join(root, 'windows-home');
    fs.mkdirSync(base);
    fs.chmodSync(base, 0o777);
    vi.stubEnv('MONOMIND_HOME', base);
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!;
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
    try {
      const dir = createRunnerInputDir('kimi', args('kimi'));
      expect(fs.existsSync(dir)).toBe(true);
      fs.rmSync(dir, { recursive: true });
    } finally { Object.defineProperty(process, 'platform', platform); }
  });
  it.runIf(process.platform !== 'win32').each(['fifo', 'spawn'])('cleans up Cline after %s setup fails', (stage) => {
    const inputs = path.join(state.home, '.monomind', 'runner-inputs');
    const before = fs.readdirSync(inputs);
    if (stage === 'fifo') vi.mocked(execFileSync).mockImplementationOnce(() => { throw new Error('setup failed'); });
    else vi.mocked(spawn).mockImplementationOnce(() => { throw new Error('setup failed'); });
    expect(() => launchCline({ bin, env: {}, configArgs: [], dataDirArgs: [], dataDir: work, scoped: true }, [], args('cline'), fakeHost(), { stdinPrompt: 'secret' })).toThrow('setup failed');
    expect(fs.readdirSync(inputs)).toEqual(before);
  });
  it.each(['kimi', 'cline'])('cleans up %s inputs when the initial write fails', async (kind) => {
    const inputs = path.join(state.home, '.monomind', 'runner-inputs');
    const before = fs.readdirSync(inputs);
    vi.mocked(writeRunnerInput).mockImplementationOnce(() => { throw new Error('write failed'); });
    if (kind === 'kimi') {
      const consume = async () => { for await (const _ of new KimiCodeAgentRunner(bin).run(args('kimi'))) {} };
      await expect(consume()).rejects.toThrow('write failed');
    } else {
      expect(() => launchCline({ bin, env: {}, configArgs: [], dataDirArgs: [], dataDir: work, scoped: true }, [], args('cline'), fakeHost(), { stdinPrompt: 'secret' }, 'linux')).toThrow('write failed');
    }
    expect(fs.readdirSync(inputs)).toEqual(before);
  });
});
