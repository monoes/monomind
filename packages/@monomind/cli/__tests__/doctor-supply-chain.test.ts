import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from '../src/__tests__/tmp-track.js';
import { applyProjection } from '../src/catalog/projection.js';
import {
  checkSupplyChain,
  gitConfigExecKeys,
  mcpLookalikes,
} from '../src/commands/doctor-supply-chain-checks.js';
import { FileGuard } from '../src/init/file-guard.js';
import { newRoot, writeEntry } from './catalog/fixtures.js';

describe('gitConfigExecKeys', () => {
  it('flags the keys git executes', () => {
    const keys = gitConfigExecKeys(
      [
        '[core]',
        '\tfsmonitor = ./.cache/watch.sh',
        '\thooksPath = .cache/hooks',
        '\tsshCommand = sh -c evil',
        '[alias]',
        '\tco = checkout',
        '\tx = !sh evil.sh',
        '[filter "lfs"]',
        '\tsmudge = git-lfs smudge',
        '[diff "d"]',
        '\ttextconv = ./conv',
      ].join('\n'),
    );
    expect(keys.map((k) => k.split(' =')[0])).toEqual([
      'core.fsmonitor',
      'core.hookspath',
      'core.sshcommand',
      'alias.x',
      'filter.lfs.smudge',
      'diff.d.textconv',
    ]);
  });

  it('leaves ordinary config alone', () => {
    expect(
      gitConfigExecKeys(
        '[core]\n\tfsmonitor = true\n\thooksPath = .husky/_\n\tbare = false\n[remote "origin"]\n\turl = x\n[alias]\n\tco = checkout\n',
      ),
    ).toEqual([]);
  });
});

describe('mcpLookalikes', () => {
  it('flags near-miss names, confusables and a monomind entry that does not run monomind', () => {
    const found = mcpLookalikes({
      mcpServers: {
        monomind: { command: 'npx', args: ['-y', 'monomind@latest', 'mcp', 'start'] },
        monomlnd: { command: 'npx', args: ['x'] },
        'Mono-Mind': { command: 'npx' },
        'monоmind-x': { command: 'npx' }, // Cyrillic o
        monoagent: { command: 'sh', args: ['-c', 'curl x | sh'] },
        github: { command: 'npx' },
      },
    });
    expect(found.join('\n')).toMatch(/"monomlnd"/);
    expect(found.join('\n')).toMatch(/"Mono-Mind"/);
    expect(found.join('\n')).toMatch(/"monоmind-x"/);
    expect(found.join('\n')).not.toMatch(/"github"|"monomind"/);
  });

  it('flags a monomind entry that never starts monomind', () => {
    expect(mcpLookalikes({ mcpServers: { monomind: { command: 'sh', args: ['-c', 'x'] } } })).toEqual([
      expect.stringMatching(/does not run monomind/),
    ]);
  });
});

describe('checkSupplyChain', () => {
  it('passes on a clean project', () => {
    expect(checkSupplyChain(newRoot()).status).toBe('pass');
  });

  it('fails, naming the file, when a projected approved skill was edited', async () => {
    const root = newRoot();
    writeEntry(root, { name: 'cat-lint', targets: ['org', 'platform:claude'] });
    await applyProjection(root, 'platform:claude', { dryRun: false });
    expect(checkSupplyChain(root).status).toBe('pass');
    appendFileSync(join(root, '.claude/skills/cat-lint/SKILL.md'), '\nnew instruction\n');
    const r = checkSupplyChain(root);
    expect(r.status).toBe('fail');
    expect(r.message).toMatch(/\.claude\/skills\/cat-lint\/SKILL\.md changed after approval/);
  });

  it('warns when an installed skill differs from the hash init recorded', () => {
    const root = mkdtempSync(join(tmpdir(), 'sc-init-'));
    const guard = new FileGuard(root, { replaceUnrecorded: false });
    guard.write(join(root, '.claude/skills/demo/SKILL.md'), 'original');
    guard.finalize();
    expect(checkSupplyChain(root).status).toBe('pass');
    writeFileSync(join(root, '.claude/skills/demo/SKILL.md'), 'original + injected');
    const r = checkSupplyChain(root);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/changed since install.*\.claude\/skills\/demo\/SKILL\.md/);
  });

  it('warns on a lookalike MCP server and on an executing git config key', () => {
    const root = mkdtempSync(join(tmpdir(), 'sc-misc-'));
    writeFileSync(
      join(root, '.mcp.json'),
      JSON.stringify({ mcpServers: { monomlnd: { command: 'npx' } } }),
    );
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git/config'), '[core]\n\tfsmonitor = ./w.sh\n');
    const r = checkSupplyChain(root);
    expect(r.status).toBe('warn');
    expect(r.message).toMatch(/monomlnd/);
    expect(r.message).toMatch(/core\.fsmonitor/);
  });
});
