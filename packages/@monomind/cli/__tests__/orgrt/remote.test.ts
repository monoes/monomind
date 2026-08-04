// packages/@monomind/cli/__tests__/orgrt/remote.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadRemoteRegistry, lookupRemoteOrg } from '../../src/orgrt/remote.js';
import { ORG_DIR } from '../../src/orgrt/types.js';

describe('remote registry', () => {
  let root: string;

  beforeEach(() => {
    root = join(tmpdir(), `monomind-remote-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(root, ORG_DIR), { recursive: true });
  });

  afterEach(() => {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  });

  it('returns empty registry when file does not exist', () => {
    const reg = loadRemoteRegistry(root);
    expect(reg.hosts).toEqual({});
  });

  it('loads a valid remote-hosts.json', () => {
    const hosts = {
      'prod-org': { host: 'server1.example.com', cwd: '/opt/project', user: 'deploy' },
      'staging-org': { host: '10.0.1.5', port: 2222, cwd: '/home/ci/project' },
    };
    writeFileSync(join(root, ORG_DIR, 'remote-hosts.json'), JSON.stringify({ hosts }));
    const reg = loadRemoteRegistry(root);
    expect(Object.keys(reg.hosts)).toHaveLength(2);
    expect(reg.hosts['prod-org'].host).toBe('server1.example.com');
    expect(reg.hosts['staging-org'].port).toBe(2222);
  });

  it('lookupRemoteOrg returns null for unknown org', () => {
    expect(lookupRemoteOrg('nonexistent', root)).toBeNull();
  });

  it('lookupRemoteOrg finds a registered remote org', () => {
    const hosts = {
      'remote-team': { host: 'gpu-box.internal', cwd: '/data/project', identityFile: '~/.ssh/id_gpu' },
    };
    writeFileSync(join(root, ORG_DIR, 'remote-hosts.json'), JSON.stringify({ hosts }));
    const found = lookupRemoteOrg('remote-team', root);
    expect(found).not.toBeNull();
    expect(found!.host).toBe('gpu-box.internal');
    expect(found!.identityFile).toBe('~/.ssh/id_gpu');
  });

  it('handles malformed remote-hosts.json gracefully', () => {
    writeFileSync(join(root, ORG_DIR, 'remote-hosts.json'), 'not json');
    const reg = loadRemoteRegistry(root);
    expect(reg.hosts).toEqual({});
  });
});
