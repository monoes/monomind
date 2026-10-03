// The v2 variant's record in the fixture, the pilot manifest and the scenario manifest agree, and the weaknesses are stated.
// @ts-nocheck: plain .mjs modules
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FAULT_CLASSES } from '../../pilot/fault-injection.js';
import { pilotRow } from '../../pilot/report.js';

const here = dirname(fileURLToPath(import.meta.url));
const load = (p: string) => JSON.parse(readFileSync(join(here, p), 'utf8'));
const f = load('fixture.json').fixture;
const pilot = load('../../pilot/parallel-sweep-3.pilot.json');
const manifest = load('../../manifests/parallel-sweep-3.json');
const v = f.variants.v2;

describe('variant v2 record', () => {
  it('declares the same change in the pilot manifest and the scenario manifest, in the same format, dated 2026-10-04', () => {
    const a = pilot.declared_changes.find((c) => c.id === 'handoff-relay-consistency-check');
    const b = manifest.declared_changes.find((c) => c.id === 'handoff-relay-consistency-check');
    expect(a).toEqual(b);
    expect(Object.keys(a)).toEqual(['id', 'date', 'approved_by', 'what', 'why', 'earlier_result']);
    expect(a.date).toBe('2026-10-04');
    expect(a.approved_by).toMatch(/lead, under the owner's standing instruction/);
    expect(a.earlier_result).toMatch(/results .*stay on record|stay as measured/);
    expect(pilot.variants[0]).toMatchObject({
      id: 'v2',
      arm: 'treatment',
      deadline_seconds: pilot.deadline_seconds,
      declared_change: a.id,
    });
    expect(v.declared_change).toBe(a.id);
  });

  it('keeps the committed v1 design: arms, contracts, fault injection and staged plan are untouched', () => {
    expect(pilot.arms.map((x) => x.id)).toEqual(['baseline', 'treatment']);
    expect(pilot.contracts).toHaveLength(8);
    expect(JSON.stringify(pilot.contracts)).not.toMatch(/evidence|deliverables|checks/);
    expect(pilot.fault_injection.seed_base).toBe(20261003);
    expect(pilot.staged_plan.gate_kind).toBe('handoff-read');
    expect(f.arms.map((x) => x.id)).toEqual(['baseline', 'treatment']);
    expect(f.tasks.multi_role_documents).toMatch(/the lead tells the producing worker/);
  });

  it('says what each fault class is caught by, the evidence shape, why it is not an arithmetic sum, and the honest limit', () => {
    expect(Object.keys(v.catches)).toEqual([...FAULT_CLASSES]);
    expect(v.catches['wrong-value-q05']).toMatch(/value_matches_chain/);
    expect(v.catches['files-order']).toMatch(/files_match_evidence/);
    expect(v.catches['duplicate-sheet']).toMatch(/unique_across_sheets/);
    expect(v.evidence_shape.why_this_shape).toMatch(/not plain sums/);
    expect(v.evidence_shape.only_in_document).toMatch(/never written to out/);
    expect(v.not_caught).toMatch(/fabricates self-consistent evidence .* not caught/);
    const w = f.weaknesses.join('\n');
    expect(w).toMatch(/Variant v2: the injector corrupts value or files but never the evidence/);
    expect(w).toMatch(/fabricates consistent evidence/);
    expect(w).toMatch(/changes three things at once/);
    expect(pilot.variants[0].contract_template.checks.map((c) => c.type)).toEqual(v.checks);
  });

  it('gives the stage 1 and optional stage 2 commands with the owner phrase, the variant field and both gates', () => {
    const s = pilot.variants[0].staged_plan;
    expect(s.stage_1.run).toMatch(
      /PILOT_OWNER_DECISION=handoff-relay-consistency-check .*PILOT_ONLY=parallel-sweep-3:treatment:1:0::v2/,
    );
    expect(s.stage_2).toMatchObject({ optional: true });
    expect(s.stage_2.run).toMatch(/PILOT_ONLY=parallel-sweep-3:treatment:2:0::v2/);
    expect(s.stage_1_thresholds).toEqual({
      min_synthesiser_doc_reads: 1,
      min_synthesiser_doc_checks: 1,
    });
    expect(JSON.stringify(pilot.variants)).not.toMatch(/token/i);
  });
});

describe('the pilot report keeps a v2 trial apart from the plain treatment', () => {
  it('reads the variant from the trial record and the n from an id with the variant suffix', async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const r = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'rep-v2-'));
    const name = 'smoke-parallel-sweep-3-phase2-p2t-v2';
    mkdirSync(join(r, '.monomind/orgs', name, 'run-1'), { recursive: true });
    mkdirSync(join(r, 'pilot-state'));
    writeFileSync(join(r, '.monomind/orgs', name, 'run-1/bus.jsonl'), '');
    writeFileSync(
      join(r, 'trial.json'),
      JSON.stringify({
        name,
        scenario: 'parallel-sweep-3',
        contender: 'phase2',
        allocationUsd: 34,
        runners: {},
        pilot: { arm: 'treatment', id: 'x', variant: { id: 'v2' } },
      }),
    );
    writeFileSync(join(r, 'units.json'), '{"units":[]}');
    writeFileSync(
      join(r, 'pilot-state/pilot-events.jsonl'),
      `${[
        { kind: 'check', ok: true, role: 'synthesiser' },
        { kind: 'check', ok: false, role: 'synthesiser' },
        { kind: 'relay', ok: true, role: 'harness' },
        { kind: 'read', ok: true, role: 'synthesiser' },
      ]
        .map((e) => JSON.stringify(e))
        .join('\n')}\n`,
    );
    const row = pilotRow(r);
    expect(row).toMatchObject({ arm: 'treatment', n: 2, variant: 'v2' });
    expect(row.handoff).toMatchObject({ check: { ok: 1, refused: 1 }, relays: 1, total: 1 });
  });
});
