// packages/@monomind/cli/__tests__/orgrt/policy.test.ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OrgBus } from '../../src/orgrt/bus.js';
import { PolicyEngine, globToRegExp } from '../../src/orgrt/policy.js';

const mkBus = () => new OrgBus('o', 'r', mkdtempSync(join(tmpdir(), 'pol-')));

describe('PolicyEngine', () => {
  it('denies tools on the deny list', async () => {
    const p = new PolicyEngine('coder', { denyTools: ['Bash'] }, mkBus(), '/work');
    const d = await p.decide('Bash', { command: 'ls -la' });
    expect(d.behavior).toBe('deny');
  });

  it('always denies harness messaging tools with a pointer to org_send', async () => {
    // No denyTools config needed — SendMessage bypasses the org bus and its
    // "no agent reachable" SDK error deadlocked a real run (agent concluded
    // its teammate was down and gave up).
    const p = new PolicyEngine('researcher', {}, mkBus(), '/work');
    const d = await p.decide('SendMessage', { recipient: 'director', message: 'hi' });
    expect(d.behavior).toBe('deny');
    expect((d as { message: string }).message).toMatch(/org_send/);
  });

  it('enforces file write scopes with globs', async () => {
    const p = new PolicyEngine('coder', { fileWrite: ['src/**', 'docs/**'] }, mkBus(), '/work');
    expect((await p.decide('Write', { file_path: '/work/src/a.ts' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: '/work/.env' })).behavior).toBe('deny');
    expect((await p.decide('Edit', { file_path: '/etc/passwd' })).behavior).toBe('deny');
  });

  it('denies relative paths that escape the workdir via ..', async () => {
    const p = new PolicyEngine('coder', { fileWrite: ['src/**'] }, mkBus(), '/work');
    expect((await p.decide('Write', { file_path: 'src/../../etc/passwd' })).behavior).toBe('deny');
  });

  it('denies Grep relative path inputs that escape the workdir', async () => {
    const p = new PolicyEngine('coder', { fileRead: ['src/**'] }, mkBus(), '/work');
    expect((await p.decide('Grep', { path: 'src/../../../etc' })).behavior).toBe('deny');
  });

  it('allows relative paths within scope', async () => {
    const p = new PolicyEngine('coder', { fileWrite: ['src/**'] }, mkBus(), '/work');
    expect((await p.decide('Write', { file_path: 'src/a.ts' })).behavior).toBe('allow');
  });

  it('enforces web research domain allowlist', async () => {
    const p = new PolicyEngine('researcher', { webAllow: ['docs.claude.com'] }, mkBus(), '/work');
    expect((await p.decide('WebFetch', { url: 'https://docs.claude.com/x' })).behavior).toBe('allow');
    expect((await p.decide('WebFetch', { url: 'https://evil.example.com' })).behavior).toBe('deny');
    const noWeb = new PolicyEngine('coder', { webAllow: [] }, mkBus(), '/work');
    expect((await noWeb.decide('WebSearch', { query: 'x' })).behavior).toBe('deny');
  });

  it('denies everything after token budget exhaustion', async () => {
    const p = new PolicyEngine('coder', { maxTokens: 100 }, mkBus(), '/work');
    p.addUsage(150);
    expect((await p.decide('Read', { file_path: '/work/a' })).behavior).toBe('deny');
  });

  it('emits an audit event for every decision', async () => {
    const bus = mkBus();
    const seen: string[] = [];
    bus.subscribe(e => { if (e.type === 'tool') seen.push(`${e.tool}:${e.decision}`); });
    const p = new PolicyEngine('coder', { denyTools: ['Bash'] }, bus, '/work');
    await p.decide('Read', { file_path: '/work/a' });
    await p.decide('Bash', { command: 'ls' });
    expect(seen).toEqual(['Read:allow', 'Bash:deny']);
  });

  it('captures the full content on an allowed Write as an asset snapshot (for diffing)', async () => {
    const bus = mkBus();
    const assets: any[] = [];
    bus.subscribe(e => { if (e.type === 'asset') assets.push(e); });
    const p = new PolicyEngine('coder', {}, bus, '/work');
    await p.decide('Write', { file_path: '/work/report.md', content: '# v1\nhello' });
    await p.decide('Write', { file_path: '/work/report.md', content: '# v1\nhello world' });
    expect(assets).toHaveLength(2);
    expect(assets[0].data?.content).toBe('# v1\nhello');
    expect(assets[1].data?.content).toBe('# v1\nhello world');
  });

  it('does not snapshot Edit content (no full post-edit content is available at decide time)', async () => {
    const bus = mkBus();
    const assets: any[] = [];
    bus.subscribe(e => { if (e.type === 'asset') assets.push(e); });
    const p = new PolicyEngine('coder', {}, bus, '/work');
    await p.decide('Edit', { file_path: '/work/report.md', old_string: 'a', new_string: 'b' });
    expect(assets).toHaveLength(1);
    expect(assets[0].data).toBeUndefined();
  });

  it('skips the content snapshot for writes over the size cap, still emits the asset event', async () => {
    const bus = mkBus();
    const assets: any[] = [];
    bus.subscribe(e => { if (e.type === 'asset') assets.push(e); });
    const p = new PolicyEngine('coder', {}, bus, '/work');
    const huge = 'x'.repeat(200_001);
    await p.decide('Write', { file_path: '/work/big.txt', content: huge });
    expect(assets).toHaveLength(1);
    expect(assets[0].data).toBeUndefined();
  });

  it('globToRegExp: a leading **/ matches zero directories too, not just one-or-more', () => {
    const re = globToRegExp('**/*.md');
    expect(re.test('README.md')).toBe(true);   // root-level — was incorrectly denied before the fix
    expect(re.test('docs/README.md')).toBe(true);
    expect(re.test('a/b/README.md')).toBe(true);
    expect(re.test('README.txt')).toBe(false);
  });

  it('denies a path-less Grep/Glob call when the role has a restricted read scope (was a full-scope bypass)', async () => {
    const p = new PolicyEngine('coder', { fileRead: ['src/**'] }, mkBus(), '/work');
    const d = await p.decide('Grep', { pattern: 'password' }); // no path/file_path at all
    expect(d.behavior).toBe('deny');
  });

  it('still allows a path-less Grep/Glob call when the role has no read restriction', async () => {
    const p = new PolicyEngine('coder', {}, mkBus(), '/work');
    const d = await p.decide('Grep', { pattern: 'password' });
    expect(d.behavior).toBe('allow');
  });
});
