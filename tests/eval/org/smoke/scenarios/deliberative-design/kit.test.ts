import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { CONTENDERS } from '../../lib.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs, prepareTrial } from '../../prepare.mjs';
// @ts-expect-error plain .mjs modules
import * as kit from './kit.mjs';

const OPTIONS = ['JSONL', 'SQLite', 'columnar file'];
const CRITERIA = [
  'no new dependency',
  'crash-safe append',
  'inspectable with standard tools',
  'query by role and time',
  'implementation effort',
];
const SCORES: Record<string, number[]> = {
  JSONL: [5, 4, 5, 2, 5],
  SQLite: [4, 5, 3, 5, 3],
  'columnar file': [2, 2, 2, 4, 2],
};

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

const goodRecord = () => ({
  question: 'Which on-disk format?',
  options: OPTIONS.map((name) => ({
    name,
    scores: Object.fromEntries(
      CRITERIA.map((c, i) => [c, { score: SCORES[name][i], reason: `${name} on ${c}` }]),
    ) as Record<string, { score: number; reason: string }>,
    total: sum(SCORES[name]),
  })),
  chosen: 'JSONL',
  rationale: 'Highest total.',
});

const goodLog = () => [
  { role: 'critic', objection: 'JSONL is slow to query', disposition: 'accepted' },
  {
    role: 'advocate',
    objection: 'SQLite is a dependency',
    disposition: 'rejected',
    reason: 'node:sqlite is built in',
  },
  { role: 'critic', objection: 'torn lines', disposition: 'deferred' },
];

async function run(record?: unknown, log?: unknown) {
  const ws = mkdtempSync(join(tmpdir(), 'dd-'));
  const put = (file: string, v: unknown) =>
    v !== undefined && writeFileSync(join(ws, file), typeof v === 'string' ? v : JSON.stringify(v));
  put('decision-record.json', record);
  put('objection-log.json', log);
  const units = await kit.check({ root: ws, workspace: ws, inputs: '', trial: {} });
  const by = (u: string) => units.find((x: { unit: string }) => x.unit === u);
  return { rec: by('decision-record'), log: by('objection-log'), units };
}

describe('deliberative-design kit: inputs and definition', () => {
  it('builds QUESTION.md and CONTEXT.md carrying the fixture', async () => {
    const base = mkdtempSync(join(tmpdir(), 'dd-base-'));
    const inputs = await buildInputs({ scenario: 'deliberative-design', base });
    const q = readFileSync(join(inputs, 'workspace/QUESTION.md'), 'utf8');
    for (const s of [...OPTIONS, ...CRITERIA, 'decision-record.json', 'objection-log.json'])
      expect(q).toContain(s);
    expect(q).toContain('no new runtime dependency');
    expect(readFileSync(join(inputs, 'workspace/CONTEXT.md'), 'utf8')).toContain('bus.jsonl');
  });

  it.each(CONTENDERS)('prepares a valid org for %s within the $8 allocation', async (contender) => {
    const base = mkdtempSync(join(tmpdir(), 'dd-base-'));
    await buildInputs({ scenario: 'deliberative-design', base });
    const root = await prepareTrial({
      scenario: 'deliberative-design',
      base,
      contender,
      trial: '1',
    });
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    expect(trial).toMatchObject({ deadlineSeconds: 2700, allocationUsd: 8 });
    expect(trial.task).toMatch(/decision-record\.json/);
    expect(trial.task).toMatch(/objection-log\.json/);
    const org = JSON.parse(readFileSync(join(root, `.monomind/orgs/${trial.name}.json`), 'utf8'));
    const parsed = OrgDefSchema.parse(org);
    expect(checklistFindings(parsed).errors).toEqual([]);
    expect(org.roles.length).toBe(4);
    // The lead is Claude Haiku (priced); the deliberators run on antigravity, capped by tokens.
    for (const r of org.roles)
      if (r.reports_to != null)
        expect([r.runtime, r.adapter_config.model, r.budget_tokens]).toEqual([
          'antigravity',
          'gemini-3.8-flash-high',
          4_000_000,
        ]);
    expect(
      sum(org.roles.map((r: { budget_usd?: number }) => r.budget_usd ?? 0)),
    ).toBeLessThanOrEqual(8);
    expect(org.roles.filter((r: { reports_to: unknown }) => r.reports_to === null)).toHaveLength(1);
  });
});

describe('deliberative-design kit: check', () => {
  it('accepts a good record and log', async () => {
    const { rec, log } = await run(goodRecord(), goodLog());
    expect(rec).toMatchObject({ unit: 'decision-record', accepted: true });
    expect(rec.evidence.failures).toEqual([]);
    expect(rec.evidence.needsReview).toBe(true);
    expect(rec.critical).toEqual([]);
    expect(log).toMatchObject({ unit: 'objection-log', accepted: true });
    expect(log.evidence.needsReview).toBe(true);
  });

  it('rejects absent or unparseable files without a critical failure', async () => {
    const { rec, log } = await run('{not json');
    expect(rec.accepted).toBe(false);
    expect(log.accepted).toBe(false);
    expect(rec.critical).toEqual([]);
  });

  it('rejects a total mismatch', async () => {
    const r = goodRecord();
    r.options[0].total = 99;
    const { rec } = await run(r, goodLog());
    expect(rec.accepted).toBe(false);
    expect(rec.evidence.failures.join()).toMatch(/total/);
  });

  it('rejects a chosen option that is not the highest and flags it critical', async () => {
    const r = goodRecord();
    r.chosen = 'columnar file';
    const { rec } = await run(r, goodLog());
    expect(rec.accepted).toBe(false);
    expect(rec.critical.join()).toMatch(/contradicts/);
  });

  it('accepts any of tied options, rejects one outside the tie', async () => {
    const tie = goodRecord();
    // JSONL totals 21; lift SQLite from 20 to 21.
    tie.options[1].scores['implementation effort'].score = 4;
    for (const o of tie.options) o.total = sum(Object.values(o.scores).map((s) => s.score));
    expect(tie.options[0].total).toBe(tie.options[1].total);
    tie.chosen = 'SQLite';
    expect((await run(tie, goodLog())).rec.accepted).toBe(true);
    tie.chosen = 'columnar file';
    expect((await run(tie, goodLog())).rec.accepted).toBe(false);
  });

  it('rejects a missing mandatory option and flags it critical', async () => {
    const r = goodRecord();
    r.options = r.options.filter((o) => o.name !== 'SQLite');
    const { rec } = await run(r, goodLog());
    expect(rec.accepted).toBe(false);
    expect(rec.critical.join()).toMatch(/option.*SQLite/);
  });

  it('rejects a missing criterion and flags it critical', async () => {
    const r = goodRecord();
    delete r.options[2].scores['implementation effort'];
    r.options[2].total -= 2;
    const { rec } = await run(r, goodLog());
    expect(rec.accepted).toBe(false);
    expect(rec.critical.join()).toMatch(/criterion.*implementation effort/);
  });

  it('rejects an empty reason or an out-of-range score', async () => {
    const r = goodRecord();
    r.options[0].scores['crash-safe append'].reason = ' ';
    expect((await run(r, goodLog())).rec.accepted).toBe(false);
    const s = goodRecord();
    s.options[0].scores['crash-safe append'].score = 6;
    expect((await run(s, goodLog())).rec.accepted).toBe(false);
  });

  it('matches options and chosen case-insensitively', async () => {
    const r = goodRecord();
    r.options[0].name = 'jsonl';
    r.chosen = 'Jsonl';
    expect((await run(r, goodLog())).rec.accepted).toBe(true);
  });

  it('rejects a chosen option that is not one of the options', async () => {
    const r = goodRecord();
    r.chosen = 'parquet';
    expect((await run(r, goodLog())).rec.accepted).toBe(false);
  });

  it('rejects an objection log from a single role', async () => {
    const l = goodLog().map((o) => ({ ...o, role: 'critic' }));
    const { log } = await run(goodRecord(), l);
    expect(log.accepted).toBe(false);
    expect(log.evidence.failures.join()).toMatch(/two distinct roles/);
  });

  it('rejects a rejected objection without a reason, and a bad disposition', async () => {
    const l: Record<string, unknown>[] = goodLog();
    delete l[1].reason;
    expect((await run(goodRecord(), l)).log.accepted).toBe(false);
    const m: Record<string, unknown>[] = goodLog();
    m[0].disposition = 'ignored';
    expect((await run(goodRecord(), m)).log.accepted).toBe(false);
    expect((await run(goodRecord(), { role: 'a' })).log.accepted).toBe(false);
  });

  it('judges each unit on its own file', async () => {
    const { rec, log } = await run(goodRecord(), 'oops');
    expect(rec.accepted).toBe(true);
    expect(log.accepted).toBe(false);
  });
});
