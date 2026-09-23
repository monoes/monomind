import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { catalogDir, packageDigest, packagesDir } from '../../src/catalog/digest.js';
import {
  CatalogStateError,
  loadCatalogState,
  mutateCatalogState,
  statePath,
  transition,
} from '../../src/catalog/state.js';
import { type CatalogEntry, CatalogEntrySchema, type CatalogState } from '../../src/catalog/types.js';

const NOW = '2026-09-22T10:00:00.000Z';
const newRoot = (): string => mkdtempSync(join(tmpdir(), 'cat-state-'));

/** Writes a real package into the store and returns its digest. */
function writePackage(root: string, name: string, files: Record<string, string>): string {
  const tmp = mkdtempSync(join(tmpdir(), 'cat-pkg-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(tmp, rel, '..'), { recursive: true });
    writeFileSync(join(tmp, rel), body);
  }
  const sha = packageDigest(tmp);
  const dir = join(packagesDir(root), name, sha.slice(0, 12));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return sha;
}

function entry(over: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    id: 'skill:example',
    kind: 'skill',
    status: 'staged',
    sha256: 'a'.repeat(64),
    source: { kind: 'local', path: '/src/example', path_in_source: 'skills/example', license: 'MIT' },
    inspection: {
      verdict: 'clean',
      accepted: ['SKILL.md'],
      rejected: [],
      requestedTools: [],
      scanner: { ok: true, blocked: false, summary: '' },
      at: NOW,
    },
    targets: [],
    grantedTools: [],
    replacesLegacy: false,
    createdAt: NOW,
    updatedAt: NOW,
    history: [{ from: null, to: 'staged', actor: 't', at: NOW }],
    ...over,
  };
}
const stateOf = (...entries: CatalogEntry[]): CatalogState => ({ schemaVersion: 1, entries });
const ctx = (root: string, reason?: string) => ({ actor: 't', now: NOW, reason, root });

describe('loadCatalogState', () => {
  it('returns the empty state without creating anything when state is absent', () => {
    const root = newRoot();
    expect(loadCatalogState(root)).toEqual({ schemaVersion: 1, entries: [] });
    expect(existsSync(catalogDir(root))).toBe(false);
  });

  it('throws CatalogStateError on malformed JSON and a failed mutation leaves the bytes alone', () => {
    const root = newRoot();
    mkdirSync(catalogDir(root), { recursive: true });
    writeFileSync(statePath(root), '{ not json');
    expect(() => loadCatalogState(root)).toThrow(CatalogStateError);
    expect(() => mutateCatalogState(root, (s) => s)).toThrow(CatalogStateError);
    expect(readFileSync(statePath(root), 'utf8')).toBe('{ not json');
  });
});

describe('CatalogEntrySchema', () => {
  it('rejects a bad id', () => {
    expect(CatalogEntrySchema.safeParse(entry({ id: 'bad id' })).success).toBe(false);
  });
  it('rejects unknown keys', () => {
    expect(CatalogEntrySchema.safeParse({ ...entry(), extra: 1 }).success).toBe(false);
  });
  it('rejects a git source URL carrying userinfo, accepts the plain and ssh forms', () => {
    const git = (url: string) =>
      entry({ source: { kind: 'git', url, commit: 'b'.repeat(40), path: '.', license: 'MIT' } });
    expect(() => CatalogEntrySchema.parse(git('https://user:tok@github.com/o/r.git'))).toThrow();
    expect(() => CatalogEntrySchema.parse(git('https://tok@github.com/o/r.git'))).toThrow();
    expect(CatalogEntrySchema.parse(git('https://github.com/o/r.git')).source).toMatchObject({ kind: 'git' });
    expect(CatalogEntrySchema.parse(git('git@github.com:o/r.git')).source).toMatchObject({ kind: 'git' });
  });
  it('rejects the unknown target platform:codex', () => {
    const bad = { ...entry(), targets: ['platform:codex'] };
    expect(CatalogEntrySchema.safeParse(bad).success).toBe(false);
  });
  it('rejects jev without org', () => {
    expect(CatalogEntrySchema.safeParse(entry({ targets: ['jev'] })).success).toBe(false);
    expect(CatalogEntrySchema.safeParse(entry({ targets: ['org', 'jev'] })).success).toBe(true);
  });
  it('rejects duplicate targets', () => {
    expect(CatalogEntrySchema.safeParse(entry({ targets: ['org', 'org'] })).success).toBe(false);
  });
  it('rejects grants outside CATALOG_GRANTABLE_TOOLS', () => {
    const bad = { ...entry(), grantedTools: ['config_set'] };
    expect(CatalogEntrySchema.safeParse(bad).success).toBe(false);
    expect(CatalogEntrySchema.safeParse(entry({ grantedTools: ['monograph_query'] })).success).toBe(
      true,
    );
  });
});

describe('transition', () => {
  it('refuses staged → active (must be approved first)', () => {
    const root = newRoot();
    expect(() => transition(stateOf(entry()), 'skill:example', 'active', ctx(root))).toThrow(
      /approved/,
    );
  });
  it('refuses quarantined → approved', () => {
    const root = newRoot();
    const s = stateOf(entry({ status: 'quarantined' }));
    expect(() => transition(s, 'skill:example', 'approved', ctx(root))).toThrow();
  });
  it('refuses every move out of revoked', () => {
    const root = newRoot();
    const s = stateOf(entry({ status: 'revoked' }));
    for (const to of ['staged', 'approved', 'active', 'disabled', 'quarantined'] as const)
      expect(() => transition(s, 'skill:example', to, ctx(root, 'r'))).toThrow();
  });
  it('requires a reason for release', () => {
    const root = newRoot();
    const s = stateOf(entry({ status: 'quarantined' }));
    expect(() => transition(s, 'skill:example', 'staged', ctx(root))).toThrow(/reason/);
    expect(transition(s, 'skill:example', 'staged', ctx(root, 'reviewed')).entries[0].status).toBe(
      'staged',
    );
  });
  it('does not mutate its input', () => {
    const root = newRoot();
    const s = stateOf(entry());
    const before = JSON.stringify(s);
    transition(s, 'skill:example', 'quarantined', ctx(root, 'suspicious'));
    expect(JSON.stringify(s)).toBe(before);
  });
  it('activates a verified package and refuses a tampered one with digest-mismatch', () => {
    const root = newRoot();
    const sha = writePackage(root, 'example', { 'SKILL.md': '---\nname: example\n---\nbody' });
    const s = stateOf(entry({ status: 'approved', sha256: sha, targets: ['org'] }));
    expect(transition(s, 'skill:example', 'active', ctx(root)).entries[0].status).toBe('active');
    writeFileSync(join(packagesDir(root), 'example', sha.slice(0, 12), 'SKILL.md'), 'edited');
    expect(() => transition(s, 'skill:example', 'active', ctx(root))).toThrow(/digest-mismatch/);
  });
  it('caps history at 20 records, newest last', () => {
    const root = newRoot();
    let s = stateOf(entry());
    for (let i = 0; i < 15; i++) {
      s = transition(s, 'skill:example', 'quarantined', ctx(root, `q${i}`));
      s = transition(s, 'skill:example', 'staged', ctx(root, `r${i}`));
    }
    const h = s.entries[0].history;
    expect(h).toHaveLength(20);
    expect(h.at(-1)).toMatchObject({ from: 'quarantined', to: 'staged', reason: 'r14' });
  });
});

describe('mutateCatalogState', () => {
  it('writes validated state atomically', () => {
    const root = newRoot();
    mutateCatalogState(root, (s) => ({ ...s, entries: [entry()] }));
    expect(loadCatalogState(root).entries.map((e) => e.id)).toEqual(['skill:example']);
    expect(existsSync(join(root, '.monomind', 'locks', 'catalog.lock'))).toBe(false);
  });
  it('writes nothing when the new state fails validation', () => {
    const root = newRoot();
    expect(() =>
      mutateCatalogState(root, (s) => ({ ...s, entries: [entry(), entry()] })),
    ).toThrow();
    expect(existsSync(statePath(root))).toBe(false);
  });
  it('refuses a concurrent mutation instead of losing an update', () => {
    const root = newRoot();
    mutateCatalogState(root, (s) => {
      expect(() => mutateCatalogState(root, (inner) => inner)).toThrow(/locked/);
      return { ...s, entries: [entry()] };
    });
    expect(loadCatalogState(root).entries).toHaveLength(1);
  });
});
