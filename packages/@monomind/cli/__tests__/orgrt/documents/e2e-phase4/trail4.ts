// P4.12: the trail of the combined Phase 4 scenario (writer, budgets, rework, loop on one org) as a small, order-stable
// record: what the store committed per document, the notices both journals delivered, who was told what, the refusals,
// the budget state, the rework and loop reports and the engines each role runs. Events of different documents interleave
// by timing, so the record is grouped per document and everything else is a sorted or counted view; volatile values go
// through the P3.0 normaliser.
//
// Golden: fixtures/phase4/e2e-combined-trail.json was captured once from the scenario and reviewed line by line against the
// scenario's own assertions. It is never written by a plain run. To re-capture it deliberately (a reviewed change of the
// Phase 4 runtime's observable behaviour), run from the cli package:
//   PHASE4_E2E_RECAPTURE=P4.12 npx vitest run __tests__/orgrt/documents/e2e-phase4/combined.e2e.test.ts
// and review the fixture diff line by line. Any other value is refused. The P3.14 variable (SECTIONS_ON_E2E_RECAPTURE) is
// not used here and the P3.14 golden is read, never written, by this directory.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { DocumentsRuntime } from '../../../../src/orgrt/documents/runtime.js';
import type { RunningOrg } from '../../../../src/orgrt/daemon-types.js';
import { fileTree } from '../../support/golden-run.js';
import { normalizeGolden, normalizeString } from '../../support/normalize-golden.js';
import type { CostScripted } from './world.js';

export const jsonl = (file: string): any[] =>
  existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];

const GOLDEN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'phase4');
export const RECAPTURE_PIECES = ['P4.12'];

export function expectGolden4(name: string, actual: unknown, env: NodeJS.ProcessEnv = process.env): void {
  const file = join(GOLDEN_DIR, `${name}.json`);
  const got = JSON.parse(JSON.stringify(actual)) as unknown;
  const piece = env.PHASE4_E2E_RECAPTURE;
  if (piece) {
    if (!RECAPTURE_PIECES.includes(piece)) throw new Error(`PHASE4_E2E_RECAPTURE=${piece} is refused: only ${RECAPTURE_PIECES.join(', ')} may re-capture`);
    mkdirSync(GOLDEN_DIR, { recursive: true });
    writeFileSync(file, `${JSON.stringify(got, null, 2)}\n`);
    return;
  }
  if (!existsSync(file)) throw new Error(`golden "${name}" is missing; fixtures are committed, never created by a test run`);
  expect(got).toEqual(JSON.parse(readFileSync(file, 'utf8')));
}

const subjectOf = (t: string): string => /subject: (.*)/.exec(t)?.[1] ?? normalizeString(t.split('\n')[0]).slice(0, 30);

function storeLine(e: any): string {
  switch (e.type) {
    case 'published':
      return `published v${e.version} by ${e.by}${e.supersedes ? ` (supersedes v${e.supersedes})` : ''}`;
    case 'refused':
      return `refused ${e.op} ${e.code} by ${e.by}`;
    case 'read':
      return `read v${e.version} by ${e.by} (${e.purpose})`;
    default:
      return `decided v${e.version} ${e.decision} by ${e.by} -> ${e.status_after}${e.override ? ' (override)' : ''}${e.reason ? `: ${e.reason}` : ''}`;
  }
}

const kindOfKey = (k: string): string => ({ p: 'publish-notice', r: 'relay', x: 'rework-exhausted', l: 'loop-exhausted', a: 'all-available' } as Record<string, string>)[k.split(':')[0]] ?? k.split(':')[0];

export interface Trail4Input {
  root: string;
  running: RunningOrg;
  docs: DocumentsRuntime;
  runner: CostScripted;
  roles: string[];
  refusals: Array<{ step: string; code?: string; guard_code?: string }>;
}

export function trail4Of(i: Trail4Input): Record<string, unknown> {
  const { docs, runner, running } = i;
  const events = jsonl(join(docs.dir, 'events.jsonl'));
  const perDoc: Record<string, string[]> = {};
  for (const e of events) (perDoc[e.doc] ??= []).push(storeLine(e));
  const journal = jsonl(join(docs.dir, 'notices.jsonl'));
  const delivered: Record<string, number> = {};
  for (const j of journal.filter((x) => x.t === 'delivered')) delivered[kindOfKey(j.key)] = (delivered[kindOfKey(j.key)] ?? 0) + 1;
  const sb = running.sectionBudget!;
  const told: Record<string, string[]> = {};
  for (const r of i.roles) told[r] = runner.messages(r).map(subjectOf).sort();
  const reasons: Record<string, number> = {};
  for (const e of running.busEvents().filter((x) => x.type === 'audit'))
    if (/^doc-|^section-budget|^writer-|^hot-reload|^role-budget/.test(e.reason ?? '')) reasons[e.reason ?? '?'] = (reasons[e.reason ?? '?'] ?? 0) + 1;
  const trail = {
    engines: Object.fromEntries(
      i.roles.map((r) => {
        const p = running.agents.get(r)!.policy;
        return [r, { engine: p.constructor.name, fileWrite: p.policy.fileWrite, maxUsd: p.policy.maxUsd }];
      }),
    ),
    store: perDoc,
    heads: Object.fromEntries(docs.store.list().map((d) => [d.id, d.versions.map((v) => `v${v.version}:${v.status}`)])),
    attempts: { build: docs.store.attempts('build'), report: docs.store.attempts('report') },
    refusals: i.refusals,
    notices: { delivered, failed: journal.filter((x) => x.t === 'failed').length, again: journal.filter((x) => x.again).length },
    budget: {
      records: sb.notices.records().map((r: any) => `${r.kind} ${r.to} ${r.state}`).sort(),
      closed: [...sb.closed].sort(),
      mailboxes: Object.fromEntries(i.roles.map((r) => [r, running.agents.get(r)!.mailbox.isClosed ? `closed:${running.agents.get(r)!.mailbox.closeReason}` : 'open'])),
      spent: Object.fromEntries(i.roles.map((r) => [r, running.agents.get(r)!.metrics.costUsd])),
    },
    rework: docs.reworkReport(),
    loops: docs.loopReport(),
    told,
    busReasons: reasons,
    files: fileTree(docs.dir),
  };
  return normalizeGolden(trail, { roots: [i.root] }) as Record<string, unknown>;
}
