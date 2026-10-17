// Defects found running the reputation-panel org (2026-10-17), now caught by `org validate`:
// completion_evidence on for roles that cannot produce commit evidence, a token budget too small
// for the roles that browse, and file scopes on a runtime with no sandbox to enforce them.
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../src/orgrt/types.js';
import { checklistFindings } from '../../src/orgrt/validate-checklist.js';

const worker = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  title: id,
  reports_to: 'boss',
  responsibilities: ['Do the work.'],
  ...extra,
});
const org = (workers: unknown[], run_config: Record<string, unknown> = {}) =>
  OrgDefSchema.parse({
    name: 'x',
    roles: [
      { id: 'boss', title: 'Boss', type: 'boss', responsibilities: ['Write self-contained task briefs.'] },
      ...workers,
    ],
    run_config: { max_concurrent_agents: 40, ...run_config },
    autonomy: { level: 'full' },
  });
const tagged = (def: ReturnType<typeof org>, tag: string) =>
  checklistFindings(def).warnings.filter((w) => w.includes(tag));

describe('#22 completion_evidence needs roles that can produce commit evidence', () => {
  it('names the roles that deny Bash when the gate is on', () => {
    const w = tagged(
      org([worker('researcher', { policy: { denyTools: ['Bash'] } }), worker('coder')], {
        completion_evidence: true,
      }),
      '#22',
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('researcher');
    expect(w[0]).not.toContain('coder');
  });

  it('says nothing when the gate is off, or every role can run commands', () => {
    expect(tagged(org([worker('r', { policy: { denyTools: ['Bash'] } })]), '#22')).toEqual([]);
    expect(tagged(org([worker('r', { policy: { denyTools: ['Bash'] } })], { completion_evidence: false }), '#22')).toEqual([]);
    expect(tagged(org([worker('c')], { completion_evidence: true }), '#22')).toEqual([]);
  });
});

describe('#23 the token budget is split evenly, so browsing roles need a real share', () => {
  const browsers = (n: number) =>
    Array.from({ length: n }, (_, i) => worker(`w${i}`, { policy: { webAllow: ['*'] } }));

  it('warns with the per-role share when roles that browse get under 750k each', () => {
    const w = tagged(org(browsers(11), { budget_tokens: 4_000_000 }), '#23');
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('333,333');
    expect(tagged(org(browsers(2)), '#23')).toHaveLength(1); // the 1M default across 3 roles
  });

  it('is quiet with a real share, or when no role browses', () => {
    expect(tagged(org(browsers(11), { budget_tokens: 12_000_000 }), '#23')).toEqual([]);
    const plain = Array.from({ length: 11 }, (_, i) => worker(`p${i}`));
    expect(tagged(org(plain, { budget_tokens: 4_000_000 }), '#23')).toEqual([]);
  });
});

describe('#24 an antigravity role has no sandbox to enforce its file scopes', () => {
  it('says its fileRead/fileWrite are requests, not enforced', () => {
    const w = tagged(
      org([worker('scorer', { runtime: 'antigravity', policy: { fileWrite: ['out'] } })]),
      '#24',
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('scorer');
  });

  it('is quiet without scopes, and for runtimes that enforce them', () => {
    expect(tagged(org([worker('s', { runtime: 'antigravity' })]), '#24')).toEqual([]);
    expect(tagged(org([worker('c', { policy: { fileWrite: ['out'] } })]), '#24')).toEqual([]);
  });
});

describe('#24 a codex role has a sandbox that confines writes, not reads', () => {
  it('says its fileRead scope is not enforced, and its fileWrite only as wide as the working directory', () => {
    const w = tagged(
      org([worker('scorer', { runtime: 'codex', policy: { fileRead: ['in'], fileWrite: ['out'] } })]),
      '#24',
    );
    expect(w).toHaveLength(1);
    expect(w[0]).toContain('scorer');
    expect(w[0]).toMatch(/codex/i);
    expect(w[0]).toMatch(/fileRead/);
  });

  it('is quiet for a codex role with no file scopes', () => {
    expect(tagged(org([worker('s', { runtime: 'codex' })]), '#24')).toEqual([]);
  });
});
