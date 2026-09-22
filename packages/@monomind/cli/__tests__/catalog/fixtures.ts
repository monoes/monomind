/** Shared catalog fixtures: real packages with real digests plus a state entry. */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { packageDigest, packagesDir } from '../../src/catalog/digest.js';
import { statePath } from '../../src/catalog/state.js';
import {
  type CatalogEntry,
  CatalogStateSchema,
  type CatalogStatus,
  type CatalogTarget,
} from '../../src/catalog/types.js';

export const NOW = '2026-09-22T10:00:00.000Z';

export const newRoot = (prefix = 'cat-root-'): string => mkdtempSync(join(tmpdir(), prefix));

export interface EntrySpec {
  name: string;
  kind?: CatalogEntry['kind'];
  status?: CatalogStatus;
  targets?: CatalogTarget[];
  files?: Record<string, string>;
  grantedTools?: CatalogEntry['grantedTools'];
  replacesLegacy?: boolean;
  description?: string;
  tags?: string[];
  tools?: string[];
}

const skillMd = (s: EntrySpec): string =>
  [
    '---',
    `name: ${s.name}`,
    `description: ${s.description ?? `${s.name} skill`}`,
    ...(s.tags?.length ? [`tags: [${s.tags.join(', ')}]`] : []),
    ...(s.tools?.length ? [`tools: [${s.tools.join(', ')}]`] : []),
    '---',
    '',
    `BODY-SENTINEL for ${s.name}`,
    '',
  ].join('\n');

/** Writes `<store>/<name>/<sha12>/…` and appends a matching entry to state.json. */
export function writeEntry(root: string, spec: EntrySpec): CatalogEntry & { dir: string } {
  const kind = spec.kind ?? 'skill';
  const files = spec.files ?? {
    ...(kind === 'blueprint'
      ? {
          'blueprint.json': JSON.stringify({
            name: spec.name,
            description: spec.description ?? `${spec.name} blueprint`,
          }),
        }
      : { 'SKILL.md': skillMd(spec) }),
    'LICENSE.txt': 'MIT License',
  };
  const tmp = mkdtempSync(join(tmpdir(), 'cat-fx-'));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(tmp, rel, '..'), { recursive: true });
    writeFileSync(join(tmp, rel), body);
  }
  const sha256 = packageDigest(tmp);
  const dir = join(packagesDir(root), spec.name, sha256.slice(0, 12));
  for (const [rel, body] of Object.entries(files)) {
    mkdirSync(join(dir, rel, '..'), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  const status = spec.status ?? 'active';
  const entry: CatalogEntry = {
    id: `${kind}:${spec.name}`,
    kind,
    status,
    sha256,
    source: { kind: 'local', path: `/src/${spec.name}`, path_in_source: '.', license: 'MIT' },
    inspection: {
      verdict: 'clean',
      accepted: Object.keys(files).sort(),
      rejected: [],
      requestedTools: [...(spec.tools ?? [])].sort(),
      scanner: { ok: true, blocked: false, summary: '' },
      at: NOW,
    },
    targets: spec.targets ?? (status === 'staged' || status === 'quarantined' ? [] : ['org']),
    grantedTools: spec.grantedTools ?? [],
    replacesLegacy: spec.replacesLegacy ?? false,
    createdAt: NOW,
    updatedAt: NOW,
    history: [{ from: null, to: status, actor: 'fixture', at: NOW }],
  };
  const file = statePath(root);
  const state = existsSync(file)
    ? JSON.parse(readFileSync(file, 'utf8'))
    : { schemaVersion: 1, entries: [] };
  state.entries.push(entry);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, JSON.stringify(CatalogStateSchema.parse(state), null, 2));
  return { ...entry, dir };
}

/** Edits one byte of a stored package without touching state. */
export function tamper(entry: { dir: string }, file = 'LICENSE.txt'): void {
  appendFileSync(join(entry.dir, file), 'x');
}
