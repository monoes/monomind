// P3.14: the trail of a scripted run as a small, order-stable record: what the store committed per document, what
// the notice journal delivered, the relay facts, the check calls, what each role was told, the counts. Events of
// different documents interleave by timing, so the record is grouped per document (each group is causally
// ordered) and everything else is a sorted or counted view; volatile values go through the P3.0 normaliser.
//
// Golden: fixtures/sections-on/e2e-sweep-trail.json was captured once from scenario 2 and reviewed line by line
// against the scenario's own assertions. It is never written by a plain run. To re-capture it deliberately (a reviewed change of the documents runtime's observable
// behaviour), run from the cli package:
//   SECTIONS_ON_E2E_RECAPTURE=P3.14 npx vitest run __tests__/orgrt/documents/e2e/sweep-loop.e2e.test.ts
// and review the fixture diff line by line. Any other value is refused.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { DocumentsRuntime } from '../../../../src/orgrt/documents/runtime.js';
import type { BusEvent } from '../../../../src/orgrt/types.js';
import { fileTree } from '../../support/golden-run.js';
import { normalizeGolden, normalizeString } from '../../support/normalize-golden.js';
import type { Cast } from './cast.js';
import { MINI_DOCS, idOf } from './mini-org.js';
import type { Scripted } from './scripted.js';

export const jsonl = (file: string): any[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'sections-on');
export const RECAPTURE_PIECES = ['P3.14'];

export function expectGoldenOn(name: string, actual: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const file = join(GOLDEN_DIR, `${name}.json`);
  const got = JSON.parse(JSON.stringify(actual)) as unknown;
  const piece = env.SECTIONS_ON_E2E_RECAPTURE;
  if (piece) {
    if (!RECAPTURE_PIECES.includes(piece)) throw new Error(`SECTIONS_ON_E2E_RECAPTURE=${piece} is refused: only ${RECAPTURE_PIECES.join(', ')} may re-capture`);
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    return;
  }
  if (!existsSync(file)) throw new Error(`golden "${name}" is missing; fixtures are committed, never created by a test run`);
  expect(got).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

const subjectOf = (t: string): string => /subject: (.*)/.exec(t)?.[1] ?? normalizeString(t.split('\n')[0]).slice(0, 30);
const docOf = (e: any): string => e.doc ?? idOf(e.doc_type);

function storeLine(e: any): string {
  switch (e.type) {
    case 'published':
      return `published v${e.version} by ${e.by}${e.supersedes ? ` (supersedes v${e.supersedes})` : ''}`;
    case 'refused':
      return `refused ${e.op} ${e.code} by ${e.by} (counts ${e.counts})`;
    case 'read':
      return `read v${e.version} by ${e.by} (${e.purpose})`;
    default:
      return `decided v${e.version} ${e.decision} by ${e.by} -> ${e.status_after}${e.reason ? `: ${e.reason}` : ''}`;
  }
}

export interface TrailInput {
  root: string;
  running: { busEvents(): BusEvent[] };
  docs: DocumentsRuntime;
  runner: Scripted;
  cast: Cast;
}

export function trailOf(i: TrailInput): Record<string, unknown> {
  const { docs, runner, cast } = i;
  const events = jsonl(join(docs.dir, 'events.jsonl'));
  const perDoc: Record<string, string[]> = {};
  for (const e of events) (perDoc[docOf(e)] ??= []).push(storeLine(e));
  const journal = jsonl(join(docs.dir, 'notices.jsonl'));
  const kind = (k: string) => (k.startsWith('p:') ? 'publish-notice' : k.startsWith('a:') ? 'all-available' : 'relay');
  const delivered: Record<string, number> = {};
  for (const j of journal.filter((x) => x.t === 'delivered')) delivered[kind(j.key)] = (delivered[kind(j.key)] ?? 0) + 1;
  const checks: Record<string, string[]> = {};
  for (const c of docs.checks.records())
    (checks[c.ref ?? c.id] ??= []).push(`ok=${c.ok} flagged=${c.flagged} doc_failures=${c.doc_failures} per_check=${JSON.stringify(c.per_check)}`);
  const told: Record<string, string[]> = {};
  for (const [role, texts] of runner.turns) told[role] = texts.map(subjectOf).sort();
  const reasons: Record<string, number> = {};
  for (const e of i.running.busEvents().filter((x) => x.type === 'audit'))
    if (/^doc-|cross-section|eval-boss/.test(e.reason ?? '')) reasons[e.reason ?? '?'] = (reasons[e.reason ?? '?'] ?? 0) + 1;
  const trail = {
    store: perDoc,
    heads: Object.fromEntries(docs.store.list().map((d) => [d.id, d.versions.map((v) => `v${v.version}:${v.status}`)])),
    attempts: Object.fromEntries(MINI_DOCS.map((t) => [t, docs.store.attempts(t)])),
    notices: { delivered, failed: journal.filter((x) => x.t === 'failed').length, again: journal.filter((x) => x.again).length },
    relays: docs.notices!.relayFacts()
      .map((f) => `${f.kind} ${f.doc} v${f.version} to ${f.producer}: ${f.state}, republished v${f.republished_version}, copies ${f.copies.map((c: any) => `${c.to}:${c.state}`).join(',')}`)
      .sort(),
    checks,
    checkCounts: docs.checks.counts(),
    told,
    busDocReasons: reasons,
    synthesis: cast.synthesis,
    files: fileTree(docs.dir),
  };
  // `checkCounts.by_ref` and the per-document lists are ordered by their own causal chain; the rest is sorted
  return normalizeGolden(trail, { roots: [i.root] }) as Record<string, unknown>;
}

/** Strings that would mean a fault record, a seed or an injection leaked into a message or a journal. */
export const FAULT_RECORD_WORDS = /\bfault|inject|planted|\bseed\b|from_sha|to_sha|\bplan\b/i;
export const noFaultRecord = (s: string): boolean => !FAULT_RECORD_WORDS.test(normalizeString(s));
