import { describe, expect, it } from 'vitest';
import { issueKey, keysMatch } from '../../packages/@monomind/cli/src/mesh/identity.js';
import { projectIdFor } from '../../packages/@monomind/cli/src/mesh/project-id.js';
import {
  buildAddr,
  parseAddr,
  RequestSchema,
} from '../../packages/@monomind/cli/src/mesh/protocol.js';

const hello = {
  op: 'hello',
  id: '1',
  tier: 'session',
  runtime: 'claude-code',
  pid: 4242,
  project: 'monomind-0123456789abcdef',
  projectPath: '/work/monomind',
  sessionId: 's4242',
};

describe('protocol', () => {
  it('builds and parses addresses', () => {
    const a = buildAddr('host1', 'proj', 'sess', 'agent');
    expect(a).toBe('host1/proj/sess/agent');
    expect(parseAddr(a)).toEqual({
      host: 'host1',
      project: 'proj',
      sessionId: 'sess',
      agentId: 'agent',
    });
    expect(parseAddr('host1/proj/sess')).toEqual({
      host: 'host1',
      project: 'proj',
      sessionId: 'sess',
    });
    expect(parseAddr('nope')).toBeNull();
  });

  it('defaults capabilities and tags on hello', () => {
    const r = RequestSchema.parse(hello);
    expect(r.op === 'hello' && r.capabilities).toEqual([]);
    expect(r.op === 'hello' && r.tags).toEqual([]);
  });

  it('rejects ids containing the address separator', () => {
    expect(RequestSchema.safeParse({ ...hello, sessionId: 'a/b' }).success).toBe(false);
    expect(RequestSchema.safeParse({ ...hello, alias: 'x y' }).success).toBe(false);
  });

  it('rejects unknown ops and a bad pid', () => {
    expect(RequestSchema.safeParse({ op: 'nuke', id: '1' }).success).toBe(false);
    expect(RequestSchema.safeParse({ ...hello, pid: -1 }).success).toBe(false);
  });

  it('parses a who request with filters', () => {
    const r = RequestSchema.parse({ op: 'who', id: '2', project: 'p', status: 'active' });
    expect(r.op === 'who' && r.project).toBe('p');
  });
});

describe('identity', () => {
  it('issues distinct 64-hex keys and compares in constant time', () => {
    const a = issueKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(issueKey()).not.toBe(a);
    expect(keysMatch(a, a)).toBe(true);
    expect(keysMatch(a, issueKey())).toBe(false);
    expect(keysMatch(a, 'short')).toBe(false);
  });
});

describe('projectIdFor', () => {
  it('is stable, path-safe and distinguishes paths', () => {
    const a = projectIdFor('/work/monomind');
    expect(a).toMatch(/^monomind-[0-9a-f]{16}$/);
    expect(projectIdFor('/work/monomind')).toBe(a);
    expect(projectIdFor('/other/monomind')).not.toBe(a);
  });
});
