import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildSnapshot } from '../../src/catalog/snapshot.js';
import { rankOrgSkills, suggestTaskSkills } from '../../src/decision/picks.js';
import { listSkills } from '../../src/orgrt/skill-library.js';
import { newRoot, tamper, writeEntry } from '../catalog/fixtures.js';

const env = { MONOMIND_JEV_URL: 'http://127.0.0.1:3000' };
const POOL = ['org-only', 'org-jev', 'legacy'];

/** A fetch that records every request body and answers "legacy". */
function recorder() {
  const bodies: string[] = [];
  const fetchImpl = vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
    bodies.push(String(init?.body ?? ''));
    return new Response(
      JSON.stringify({
        model: 'x',
        answers: {
          skill: {
            type: 'choice',
            choice: 'legacy',
            confidence: 0.9,
            probabilities: { legacy: 0.9, __none__: 0.1 },
          },
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { bodies, fetchImpl };
}

function legacySkill(root: string): void {
  const dir = join(root, '.monomind', 'org-skills', 'legacy');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'SKILL.md'), '---\nname: legacy\ndescription: Plain helper for reviews\n---\nbody\n');
}

function project(withCatalog: boolean) {
  const root = newRoot('egress-');
  legacySkill(root);
  if (!withCatalog) return { root };
  const orgOnly = writeEntry(root, { name: 'org-only', description: 'Private review notes', targets: ['org'] });
  const orgJev = writeEntry(root, { name: 'org-jev', description: 'Shared review notes', targets: ['org', 'jev'] });
  return { root, orgOnly, orgJev };
}

const sent = (body: string, name: string): boolean => body.includes(`"${name}"`);

describe('Jev egress of catalog skills', () => {
  it('sends only jev-target catalog skills for per-task suggestions', async () => {
    const { root } = project(true);
    const { bodies, fetchImpl } = recorder();
    await suggestTaskSkills('review the notes', POOL, root, { env, fetchImpl });
    expect(bodies).toHaveLength(1);
    expect(sent(bodies[0], 'org-jev')).toBe(true);
    expect(sent(bodies[0], 'legacy')).toBe(true);
    expect(sent(bodies[0], 'org-only')).toBe(false);
  });

  it('never sends a jev-target entry that is not active', async () => {
    const root = newRoot('egress-');
    legacySkill(root);
    const idle = ['staged', 'quarantined', 'approved', 'disabled', 'revoked'] as const;
    for (const status of idle)
      writeEntry(root, { name: `jev-${status}`, status, targets: ['org', 'jev'] });
    const { bodies, fetchImpl } = recorder();
    await suggestTaskSkills('review the notes', [...idle.map((s) => `jev-${s}`), 'legacy'], root, {
      env,
      fetchImpl,
    });
    expect(bodies).toHaveLength(1);
    expect(sent(bodies[0], 'legacy')).toBe(true);
    for (const s of idle) expect(sent(bodies[0], `jev-${s}`)).toBe(false);
  });

  it('ranks org skills over the jev-visible set but keeps the rest by keyword', async () => {
    const { root } = project(true);
    const found = listSkills(root).filter((s) => POOL.includes(s.name));
    expect(found).toHaveLength(3);
    const { bodies, fetchImpl } = recorder();
    const r = await rankOrgSkills('review notes', found, 10, { env, fetchImpl, root });
    expect(bodies).toHaveLength(1);
    expect(sent(bodies[0], 'org-jev')).toBe(true);
    expect(sent(bodies[0], 'legacy')).toBe(true);
    expect(sent(bodies[0], 'org-only')).toBe(false);
    expect(r.method).toBe('jev');
    expect(r.hits[0].name).toBe('legacy');
    expect(r.hits.map((h) => h.name)).toContain('org-only');
  });

  it('withholds catalog skills entirely when no root is given', async () => {
    const { root } = project(true);
    const found = listSkills(root).filter((s) => POOL.includes(s.name));
    const { bodies, fetchImpl } = recorder();
    await rankOrgSkills('review notes', found, 10, { env, fetchImpl });
    expect(sent(bodies[0], 'org-jev')).toBe(false);
    expect(sent(bodies[0], 'org-only')).toBe(false);
  });

  it('drops a package tampered after the snapshot was cached', async () => {
    const { root, orgJev } = project(true);
    buildSnapshot(root);
    listSkills(root);
    tamper(orgJev as { dir: string });
    const { bodies, fetchImpl } = recorder();
    await suggestTaskSkills('review the notes', POOL, root, { env, fetchImpl });
    expect(sent(bodies[0], 'org-jev')).toBe(false);
    expect(sent(bodies[0], 'legacy')).toBe(true);
  });

  it('sends the same bodies as before the catalog existed when there is no state', async () => {
    const { root } = project(false);
    const capture = async (picks: typeof import('../../src/decision/picks.js')) => {
      const { bodies, fetchImpl } = recorder();
      await picks.suggestTaskSkills('review the notes', ['legacy', 'coder'], root, { env, fetchImpl });
      const found = listSkills(root).filter((s) => ['legacy', 'coder'].includes(s.name));
      await picks.rankOrgSkills('review notes', found, 10, { env, fetchImpl, root });
      return bodies;
    };
    const actual = await capture({ rankOrgSkills, suggestTaskSkills } as never);
    expect(actual).toHaveLength(2);
    vi.resetModules();
    vi.doMock('../../src/catalog/snapshot.js', () => ({
      buildSnapshot: () => ({ assets: [], diagnostics: [], stateVersion: null }),
      eligible: () => [],
    }));
    try {
      expect(await capture(await import('../../src/decision/picks.js'))).toEqual(actual);
    } finally {
      vi.doUnmock('../../src/catalog/snapshot.js');
      vi.resetModules();
    }
  });
});
