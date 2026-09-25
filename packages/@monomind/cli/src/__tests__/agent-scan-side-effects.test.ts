/**
 * Issue #337: `agent scan` must not run a runtime just to learn its version.
 * Some CLIs write state or download on `--version` (grok fetches a 159MB
 * native binary into ~/.grok, hermes writes ~/.hermes/logs and
 * .update_check). By default scan reads the version from install metadata
 * or reports `version_source: "not-probed"`; `probe: true` runs `--version`
 * in a scratch HOME that is removed afterwards.
 */

import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanInstalled } from '../orgrt/runner-registry.js';

const root = mkdtempSync(join(tmpdir(), 'monomind-scan-fx-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function listTree(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      out.push(relative(dir, p));
      if (e.isDirectory()) walk(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** A fake CLI that records each run, writes into $HOME and its cwd, and "downloads". */
function fakeCli(binDir: string, name: string, runLog: string): void {
  mkdirSync(binDir, { recursive: true });
  const script = [
    '#!/bin/sh',
    `echo "$HOME|$PWD" >> "${runLog}"`,
    `mkdir -p "$HOME/.${name}/bin" "$HOME/.${name}/logs"`,
    `echo downloaded > "$HOME/.${name}/bin/${name}-native"`,
    `echo log > "$HOME/.${name}/logs/agent.log"`,
    `echo marker > "./.${name}-cwd-marker"`,
    `echo "${name} 9.9.9"`,
  ].join('\n');
  writeFileSync(join(binDir, name), `${script}\n`);
  chmodSync(join(binDir, name), 0o755);
}

describe('agent scan is side-effect free (#337)', () => {
  let home: string;
  let binDir: string;
  let runLog: string;
  let savedHome: string | undefined;

  beforeEach(() => {
    const dir = mkdtempSync(join(root, 'case-'));
    home = join(dir, 'home');
    binDir = join(dir, 'bin');
    runLog = join(dir, 'runs.log');
    mkdirSync(home);
    writeFileSync(join(home, '.profile'), 'keep\n');
    fakeCli(binDir, 'grok', runLog);
    fakeCli(binDir, 'hermes', runLog);
    // The pre-#337 probe inherited process.env, so point the real HOME at the
    // fixture too: a regression then writes here, not into the user's HOME.
    savedHome = process.env.HOME;
    process.env.HOME = home;
  });
  afterEach(() => {
    // Only a regression writes these; do not leave them in the package dir.
    for (const id of ['grok', 'hermes'])
      rmSync(join(process.cwd(), `.${id}-cwd-marker`), { force: true });
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
  });

  it('default scan never executes grok/hermes and leaves HOME and cwd unchanged', async () => {
    const before = listTree(home);
    const result = await scanInstalled({ env: { PATH: binDir, HOME: home } });
    const byId = new Map(result.agents.map((a) => [a.id, a]));

    for (const id of ['grok', 'hermes']) {
      expect(byId.get(id), id).toMatchObject({
        installed: true,
        binary: join(binDir, id),
        version: null,
        version_source: 'not-probed',
      });
    }
    expect(existsSync(runLog), 'a fake CLI was executed').toBe(false);
    expect(listTree(home)).toEqual(before);
    for (const id of ['grok', 'hermes'])
      expect(existsSync(join(process.cwd(), `.${id}-cwd-marker`))).toBe(false);
    expect(byId.get('codex')).toMatchObject({ installed: false, version_source: null });
  });

  it('probe: true runs --version only inside a scratch HOME/cwd that is removed', async () => {
    const before = listTree(home);
    const result = await scanInstalled({
      env: { PATH: binDir, HOME: home },
      probe: true,
      versionTimeoutMs: 8000,
    });
    const grok = result.agents.find((a) => a.id === 'grok');
    expect(grok).toMatchObject({ installed: true, version: 'grok 9.9.9', version_source: 'exec' });
    expect(listTree(home)).toEqual(before);

    const runs = readFileSync(runLog, 'utf8').trim().split('\n');
    expect(runs).toHaveLength(2); // grok + hermes, once each
    for (const run of runs) {
      const [runHome, runCwd] = run.split('|');
      expect(runHome.startsWith(tmpdir()), runHome).toBe(true);
      expect(runHome).not.toBe(home);
      expect(runCwd.startsWith(tmpdir()), runCwd).toBe(true);
      expect(runCwd).not.toBe(process.cwd());
      expect(existsSync(runHome), `scratch HOME ${runHome} left behind`).toBe(false);
      expect(existsSync(runCwd), `scratch cwd ${runCwd} left behind`).toBe(false);
    }
  }, 20_000);

  it('reads the version from the owning package.json without running the binary', async () => {
    const pkg = join(root, 'npm', 'node_modules', '@xai-official', 'grok');
    mkdirSync(join(pkg, 'bin'), { recursive: true });
    fakeCli(join(pkg, 'bin'), 'grok', runLog);
    writeFileSync(
      join(pkg, 'package.json'),
      JSON.stringify({ name: '@xai-official/grok', version: '1.0.41', bin: { grok: 'bin/grok' } }),
    );
    const npmBin = join(root, 'npm', 'bin');
    mkdirSync(npmBin, { recursive: true });
    symlinkSync(join(pkg, 'bin', 'grok'), join(npmBin, 'grok'));

    const result = await scanInstalled({ env: { PATH: npmBin, HOME: home } });
    const grok = result.agents.find((a) => a.id === 'grok');
    expect(grok).toMatchObject({ version: '1.0.41', version_source: 'package.json' });
    expect(existsSync(runLog)).toBe(false);
  });

  it('ignores a package.json that does not own the binary', async () => {
    const dir = join(root, 'unrelated');
    fakeCli(join(dir, 'bin'), 'hermes', runLog);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'app', version: '3.0.0' }));
    const result = await scanInstalled({ env: { PATH: join(dir, 'bin'), HOME: home } });
    expect(result.agents.find((a) => a.id === 'hermes')).toMatchObject({
      version: null,
      version_source: 'not-probed',
    });
  });

  it('reads the version from a mise/asdf install directory', async () => {
    const installs = join(root, 'mise', 'installs', 'pipx-hermes-agent');
    const bin = join(installs, '0.19.0', 'bin');
    fakeCli(bin, 'hermes', runLog);
    symlinkSync(join(installs, '0.19.0'), join(installs, 'latest'));
    const result = await scanInstalled({
      env: { PATH: join(installs, 'latest', 'bin'), HOME: home },
    });
    expect(result.agents.find((a) => a.id === 'hermes')).toMatchObject({
      version: '0.19.0',
      version_source: 'install-path',
    });
    expect(existsSync(runLog)).toBe(false);
  });
});
