// packages/@monomind/cli/__tests__/orgrt/policy.test.ts
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
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

  // SEC: scoping compared the LEXICAL path only. A symlink inside the write
  // scope pointing outside the workdir (or at an out-of-scope file) passed the
  // glob check and let the tool write through it.
  it('resolves symlinks before scoping, so a link inside scope cannot reach outside it', async () => {
    const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'pol-real-')));
    const outside = realpathSync(mkdtempSync(join(tmpdir(), 'pol-outside-')));
    mkdirSync(join(cwd, 'src', 'ok'), { recursive: true });
    writeFileSync(join(cwd, '.env'), 'SECRET=1');
    symlinkSync(outside, join(cwd, 'src', 'escape')); // dir link → outside the workdir
    symlinkSync(join(cwd, '.env'), join(cwd, 'src', 'cfg')); // file link → inside workdir, outside scope
    symlinkSync(join(cwd, 'src', 'ok'), join(cwd, 'src', 'alias')); // dir link → still inside scope

    const p = new PolicyEngine('coder', { fileWrite: ['src/**'], fileRead: ['src/**'] }, mkBus(), cwd);
    expect((await p.decide('Write', { file_path: 'src/escape/new.ts' })).behavior).toBe('deny'); // target does not exist yet — parent link still resolved
    expect((await p.decide('Write', { file_path: join(cwd, 'src/cfg') })).behavior).toBe('deny');
    expect((await p.decide('Read', { file_path: 'src/cfg' })).behavior).toBe('deny');
    expect((await p.decide('Write', { file_path: 'src/alias/a.ts' })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: 'src/brand-new/b.ts' })).behavior).toBe('allow'); // non-existent path still scoped lexically
  });

  it('a workdir that is itself a symlink still scopes correctly', async () => {
    const real = realpathSync(mkdtempSync(join(tmpdir(), 'pol-realcwd-')));
    const link = join(realpathSync(tmpdir()), `pol-linkcwd-${process.pid}-${Date.now()}`);
    symlinkSync(real, link);
    mkdirSync(join(real, 'src'));
    const p = new PolicyEngine('coder', { fileWrite: ['src/**'] }, mkBus(), link);
    expect((await p.decide('Write', { file_path: join(link, 'src/a.ts') })).behavior).toBe('allow');
    expect((await p.decide('Write', { file_path: join(real, 'src/a.ts') })).behavior).toBe('allow');
  });
});

// SEC: every decision emits the first 200 chars of each argument, and an
// allowed Write emits up to 20KB of file content, onto the bus — persisted to
// bus.jsonl and streamed over SSE to any dashboard client. Secrets in a curl
// header or a .env write were being copied into the audit log verbatim.
// (Fake secrets are assembled at runtime so this file never contains one.)
describe('PolicyEngine — secret redaction on bus events', () => {
  const JWT = ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'abcDEF123'].join('.');
  const SK = ['sk', 'proj', 'abcdefghijklmnopqrstuvwxyz0123456789'].join('-');
  const GHP = `ghp_${'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'}`;
  const AKIA = `AKIA${'IOSFODNN7EXAMPLE'}`;
  const SK_LIVE = ['sk', 'live', 'abcdefghijklmnopqrstuvwxyz'].join('-');
  const scheme = 'Bearer';
  const QUERY_SECRET = ['api_key', 'supersecretvalue123'].join('=');
  const ENV_LINE = ['API_KEY', SK_LIVE].join('=');
  const YAML_PW = ['POSTGRES_PASSWORD', 's3cretpassw0rd'].join(': ');

  function capture() {
    const bus = mkBus();
    const tools: any[] = [];
    const assets: any[] = [];
    bus.subscribe(e => { if (e.type === 'tool') tools.push(e); if (e.type === 'asset') assets.push(e); });
    return { bus, tools, assets };
  }

  it('redacts bearer tokens and well-known API key shapes from tool-event argument summaries', async () => {
    const { bus, tools } = capture();
    const p = new PolicyEngine('coder', {}, bus, '/work');
    await p.decide('Bash', { command: `curl -H "Authorization: ${scheme} ${JWT}" https://api.example.com` });
    await p.decide('Bash', { command: `export OPENAI_API_KEY=${SK}` });
    await p.decide('Bash', { command: `gh auth login --with-token <<< ${GHP}` });
    await p.decide('Bash', { command: `aws configure set aws_access_key_id ${AKIA}` });
    await p.decide('WebFetch', { url: `https://example.com/?${QUERY_SECRET}` });
    const joined = JSON.stringify(tools.map(t => t.data));
    for (const secret of [JWT, SK, GHP, AKIA, 'supersecretvalue123']) expect(joined).not.toContain(secret);
    expect(joined).toContain('[REDACTED]');
    // the non-secret parts of the command survive so the audit trail stays useful
    expect(tools[0].data.input.command).toContain('curl -H');
    expect(tools[0].data.input.command).toContain('https://api.example.com');
  });

  it('redacts .env-style assignments and key/value pairs inside a Write snapshot', async () => {
    const { bus, assets } = capture();
    const p = new PolicyEngine('coder', {}, bus, '/work');
    await p.decide('Write', {
      file_path: '/work/config/settings.json',
      content: `{ "apiKey": "${GHP}", "region": "us-east-1", "password": "hunter2hunter2" }`,
    });
    await p.decide('Write', {
      file_path: '/work/docker-compose.yml',
      content: `services:\n  db:\n    environment:\n      ${YAML_PW}\n      DATABASE_URL: postgres://user:pw@db/app\n`,
    });
    expect(assets).toHaveLength(2);
    expect(assets[0].data.content).not.toContain(GHP);
    expect(assets[0].data.content).not.toContain('hunter2hunter2');
    expect(assets[0].data.content).toContain('us-east-1');
    expect(assets[1].data.content).not.toContain('s3cretpassw0rd');
    expect(assets[1].data.content).toContain('services:');
  });

  it('skips the content snapshot entirely for dotfiles, .env*, key material, and credential files', async () => {
    const { bus, tools, assets } = capture();
    const p = new PolicyEngine('coder', {}, bus, '/work');
    const files = ['/work/.env', '/work/.env.local', '/work/.npmrc', '/work/certs/server.pem', '/work/keys/deploy.key',
      '/work/.ssh/id_ed25519', '/work/secrets.json', '/work/aws-credentials.txt', '/work/store.p12'];
    for (const f of files) await p.decide('Write', { file_path: f, content: `${ENV_LINE}\n` });
    expect(assets).toHaveLength(files.length);
    for (const a of assets) expect(a.data, a.path).toBeUndefined();
    // the argument summary on the tool event is still redacted
    expect(JSON.stringify(tools)).not.toContain(SK_LIVE);
  });

  it('still snapshots ordinary source files in full', async () => {
    const { bus, assets } = capture();
    const p = new PolicyEngine('coder', {}, bus, '/work');
    await p.decide('Write', { file_path: '/work/src/env.ts', content: 'export const env = process.env;' });
    expect(assets[0].data.content).toBe('export const env = process.env;');
  });
});
