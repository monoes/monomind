/**
 * Upgrade refreshes installed agent files from the bundle when only their
 * frontmatter differs (older installs lack when_to_use/tags/category), and
 * leaves any agent whose body the user edited.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { refreshBundledAgents } from '../src/init/agent-refresh.js';
import { executeUpgrade } from '../src/init/upgrade.js';

const BUNDLED_CODER = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '.claude',
  'agents',
  'core',
  'coder.md',
);

const NEW_FM = '---\nname: coder\nwhen_to_use: writing code\ntags: [code]\ncategory: core\n---\n';
const OLD_FM = '---\nname: coder\ndescription: old\n---\n';
const BODY = '\n# Coder\n\nWrites code.\n';

function write(root: string, rel: string, text: string): void {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
}

describe('refreshBundledAgents', () => {
  let tmp: string;
  let source: string;
  let target: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), 'agent-refresh-'));
    source = join(tmp, 'bundle', 'agents');
    target = join(tmp, 'project', '.claude', 'agents');
    write(source, 'core/coder.md', NEW_FM + BODY);
    write(source, 'core/tester.md', '---\nname: tester\nwhen_to_use: tests\n---\nTests.\n');
    write(source, 'engineering/eng-sec.md', '---\nname: Security Engineer\nwhen_to_use: sec\n---\nSec.\n');
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it('replaces an agent whose body matches the bundled body', () => {
    write(target, 'core/coder.md', OLD_FM + BODY);
    const r = refreshBundledAgents(target, source);
    expect(r.refreshed).toEqual(['core/coder.md']);
    expect(readFileSync(join(target, 'core/coder.md'), 'utf-8')).toBe(NEW_FM + BODY);
  });

  it('keeps and reports an agent whose body the user edited', () => {
    const edited = `${OLD_FM}${BODY}\nMy house rules.\n`;
    write(target, 'core/coder.md', edited);
    const r = refreshBundledAgents(target, source);
    expect(r.refreshed).toEqual([]);
    expect(r.kept).toEqual(['core/coder.md']);
    expect(readFileSync(join(target, 'core/coder.md'), 'utf-8')).toBe(edited);
  });

  it('matches by frontmatter name when the path moved', () => {
    write(target, 'security/security-engineer.md', '---\nname: Security Engineer\n---\nSec.\n');
    const r = refreshBundledAgents(target, source);
    expect(r.refreshed).toEqual(['security/security-engineer.md']);
    expect(readFileSync(join(target, 'security/security-engineer.md'), 'utf-8')).toContain(
      'when_to_use: sec',
    );
  });

  it('skips identical files, user-only agents, and never adds files', () => {
    write(target, 'core/tester.md', '---\nname: tester\nwhen_to_use: tests\n---\nTests.\n');
    write(target, 'mine/my-agent.md', '---\nname: my-agent\n---\nMine.\n');
    const r = refreshBundledAgents(target, source);
    expect(r).toEqual({ refreshed: [], kept: [] });
    expect(() => readFileSync(join(target, 'core/coder.md'))).toThrow();
  });

  it('is a no-op the second time', () => {
    write(target, 'core/coder.md', OLD_FM + BODY);
    refreshBundledAgents(target, source);
    expect(refreshBundledAgents(target, source)).toEqual({ refreshed: [], kept: [] });
  });

  it('does nothing when the target is missing or is the source', () => {
    expect(refreshBundledAgents(join(tmp, 'nope'), source)).toEqual({ refreshed: [], kept: [] });
    expect(refreshBundledAgents(source, source)).toEqual({ refreshed: [], kept: [] });
  });
});

describe('executeUpgrade refreshes installed agents', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'upgrade-agent-refresh-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('adds the bundled metadata to an agent installed without it', async () => {
    const bundled = readFileSync(BUNDLED_CODER, 'utf-8');
    expect(bundled).toMatch(/^when_to_use:/m);
    const old = bundled.replace(/^(when_to_use|tags|category):.*\n/gm, '');
    write(dir, '.claude/agents/core/coder.md', old);
    const result = await executeUpgrade(dir);
    expect(result.refreshedAgents).toContain('core/coder.md');
    expect(readFileSync(join(dir, '.claude/agents/core/coder.md'), 'utf-8')).toBe(bundled);
  });
});
