// P4.12: the Phase 4 acceptance suite, end-to-end scripted scenarios in the real daemon (no model, no paid call).
//
// PHASE 4 ACCEPTANCE CHECKLIST (spec 13.2 "Acceptance for Phase 4 as a whole" and the P4.12 piece entry; each item is mapped
// below to the test names that prove it, and the tests at the end of this file check that every named test exists, that every
// test of this directory is named, and that every acceptance item points at tests that exist)
//
//  Scenario letters follow the piece entry: A to G as the entry defines them; H (the reload guard of P4.10) is added here because
//  the entry's list does not give it a letter. combined.e2e.test.ts walks all four keys on one org and pins the trail.
//
//  P4.12 (A) single writer: the developer writes under `writes` (a real file), a non-writer's Write and Edit are refused with the
//      core text and a writer-refused bus event, a Bash redirect is stopped by the OS sandbox, an unqualified boundary holds the
//      start, a second writer, a second writing section and worktree-per-role are refused at start
//      writer.e2e.test.ts: "the writer writes inside writes (a real file) and is refused outside; a non-writer's Write, Edit, MultiEdit and NotebookEdit are refused with the core text, one writer-refused event each"
//      writer.e2e.test.ts: "a non-writer's shell redirect is stopped at the OS: the sandbox the role was started with, run under the real bubblewrap, makes the workspace read-only"
//      writer.e2e.test.ts: "a read-only role whose boundary falls back to an expansion is held at start with writer-boundary-unqualified, a fatal crash, never widened"
//      writer.e2e.test.ts: "a second writing section is refused with the text the definition always had"
//      writer.e2e.test.ts: "a second role that can change the workspace is refused, naming both roles and the remedy"
//      writer.e2e.test.ts: "worktree-per-role together with writes is refused at definition"
//  P4.12 (B) section budgets: allocations resolved at start, the 80 percent notice once to the lead and the root, the role cap
//      closing first, an overshoot closing the section (no new assignment, tasks held, roles not woken), a reload raising it and
//      reopening it with the spend kept, a replaced incarnation counted once, the org allocation closing every role
//      budget.e2e.test.ts: "every role runs with its own cap, the table shows the partition, nobody is closed"
//      budget.e2e.test.ts: "the section lead and the root are told once at 80 percent; the role cap closes first; the allocation closes the section; a raise reopens it"
//      budget.e2e.test.ts: "a replaced incarnation is counted once: the section closes at its allocation, not later"
//      budget.e2e.test.ts: "qa closed at its allocation is not woken by a document for it; the notice waits in its inbox and a restart delivers it once"
//      budget.e2e.test.ts: "80 percent tells the root and every section lead once; at the ceiling every role is closed softly, new tasks are refused anywhere, a raise reopens"
//  P4.12 (C) rework: N rejects, one escalation to the root and both leads, the lineage frozen (REWORK_EXHAUSTED, uncounted), the
//      root decides, a reload that raises the cap thaws it
//      rework.e2e.test.ts: "the first rejection is relayed, the second spends the cap: one notice to the root and both leads, the producer is refused, the root decides"
//      rework.e2e.test.ts: "a reload that raises the cap thaws a frozen thread with no stop; the revision then goes through"
//  P4.12 (D) loops: rounds counted through `inputs`, exhaustion escalated once and a further return refused (LOOP_EXHAUSTED), the
//      root decides, a last round that is accepted ends the loop cleanly, an undeclared cycle refused at start
//      loops.e2e.test.ts: "rounds are counted through inputs; the cap is spent at the second return; the escalation goes out once; a third return is refused; the root decides"
//      loops.e2e.test.ts: "a last round that qa accepts ends the loop cleanly: no escalation, no root decision owed"
//      loops.e2e.test.ts: "an undeclared cycle between sections is a definition error naming both sections and the remedy"
//      loops.e2e.test.ts: "a loop that names an unknown section is refused at start; one that covers no cycle is a warning (it bounds nothing)"
//      loops.e2e.test.ts: "loops outside the sections surface is still not supported: it fails at start with the validate text"
//  P4.12 (E) lead rights: the capacity refusal, a cross-section org_task and org_plan_graph refused with the text, the corrected
//      org_send text, lead-aware lead-watch, unread and rework notices, the sections-off recipient unchanged
//      lead-rights.e2e.test.ts: "a sections org whose max_concurrent_agents is below its roster is refused at start, naming the remedy; the right cap starts it"
//      lead-rights.e2e.test.ts: "a member that does not report to its section lead is a validate warning, not an error"
//      lead-rights.e2e.test.ts: "org_task and org_plan_graph across sections are refused with the text; inside a section, to the root and from the root they go through"
//      lead-rights.e2e.test.ts: "the cross-section org_send refusal no longer promises a lead-to-lead path: it points at documents and the root"
//      lead-rights.e2e.test.ts: "lead-watch: a silent member with an open task, and a message assignment from its lead, tell the SECTION lead"
//      lead-rights.e2e.test.ts: "the same roster without sections keeps the reports_to recipient: the root is told, the lead is not"
//      lead-rights.e2e.test.ts: "a document nobody reads: the unread watch tells a lead, and the notices of a spent rework cap reach the root and both leads"
//  P4.12 (F) crash and resume: exactly-once recovery of a rejection committed before its relay, an exhaustion committed before its
//      notice (rework and loop) and a budget crossing before its notice; the freeze survives; a third start sends nothing
//      crash-resume.e2e.test.ts: "the resume delivers each owed message once, the freeze survives, the root decides, and a third start sends nothing"
//      crash-resume.e2e.test.ts: "the escalation goes out once after the resume, the producer is refused straight away, the root decides and the loop ends; a third start sends nothing"
//  P4.12 (G) parity: a sections-off org and a Phase 3 sections-on org with no Phase 4 key in the same daemon match the Phase 3
//      pins (the P3.14 trail golden, the P3.12 prompts); in a Phase 4 org each role's prompt holds its Phase 4 lines and only those
//      parity.e2e.test.ts: "the miniature sweep without Phase 4 keys produces the P3.14 trail golden; a sections-off org started in the same daemon has no documents and no Phase 4 text"
//      parity.e2e.test.ts: "starts every role with the P3.12 prompt, byte for byte, and no Phase 4 line"
//      parity.e2e.test.ts: "a Phase 4 org: each role's prompt holds its Phase 4 lines, and the same org with other key values differs by those lines alone"
//  P4.12 (H) the reload guard (P4.10): a structural reload is refused whole, a live key is applied
//      reload-guard.e2e.test.ts: "is refused whole and the live org carries on: ${label}"
//      reload-guard.e2e.test.ts: "a mixed reload (a raise the guard would allow and a structural key) applies nothing; the same file without the structural key is applied whole"
//      reload-guard.e2e.test.ts: "a section allocation (with the org budget), a rework cap and a loop round limit are applied together and act on the documents in flight"
//  Combined (all four keys on one org, trail pinned as fixtures/phase4/e2e-combined-trail.json)
//      combined.e2e.test.ts: "the scenario ends in the state its own assertions describe"
//      combined.e2e.test.ts: "the full trail equals the pinned golden"
//  Deferred keys (acceptance 4)
//      parity.e2e.test.ts: "still refused: ${label}"
//      parity.e2e.test.ts: "run_config.budget_usd outside the sections surface fails, and so do loops"
//
//  Phase 4 (1) the scenarios A to G of P4.12 pass in the real daemon: all of the above.
//  Phase 4 (2) the P3.0 goldens, the four SHAs, the P3.12 sections-on pins and the P4.0 net pass unchanged on the final main:
//      sections-off-golden.test.ts, frozen-sha-tripwire.test.ts, src/__tests__/org-loadouts-default-off.test.ts,
//      context-surface.test.ts, documents/sections-on-fingerprints.test.ts, documents/phase4-inert*.test.ts (run in the gate,
//      untouched), and in this directory the parity tests above (the P3.14 trail golden and the P3.12 prompts are read, never written).
//  Phase 4 (3) `writes`, `budget`, `max_rework_rounds` and `loops` each have a runtime effect or fail validate: writes (the scenario
//      A refusals), budget (B), max_rework_rounds (C), loops (D and the off-surface refusal), each also in the combined run.
//  Phase 4 (4) the deferred table of 13.2.1 still fails validate with "not yet supported" where configured: the parity tests named
//      under "Deferred keys" (max_turn_usd, allow_unbounded_turn, budget_mode strict, token partitions, parallelism.max_depth,
//      deliberative sections, requests direct, an org-wide budget_usd outside the sections surface, loops outside it).
//  Phase 4 (5), (6) reports, merges, the status block and the migration notes: process items (P4.13), no test.
//
// DEFERRED BY 9.1 AND 13.2.1, NOT TESTED HERE (no test in this suite or in Phase 4 covers them; the build did not implement them;
// where a key for one exists, only the "not yet supported" refusal above is tested):
//  - requests and answers (request/answer types, org_doc_request)
//  - blockers with terminal deadlines, idle-watchdog holds for document waits, cli recovery inspection, lead-crash pause
//  - pooled admission, reservations, sdk slices, bounded-overshoot, org_budget_transfer, unknown-spend holds
//  - per-section token partitions
//  - lead "root", replacement of a failed lead, org_respawn_role preflight for sections
//  - pinned verification and the writer drain barrier
//  - merge_owner, the cross-section writes overlap check, os write leases, per-task worktrees, isolated parallel writers
//  - deliberative sections, loans, native-child admission, provider.price for unpriced runners, idle-slot retirement, schedule on section orgs
//  - the Phase 3 deferrals that stay open: provenance before exposure, freshness, review grants, store write-protection, non-evicting outbox, completion gates, reload epochs
//  Also not covered end to end: a real process kill (the crash scenarios stop the daemon and use the notice engine's test switch
//  and the budget notice engine's close for the "died after the commit" moments), a real Claude session (the writer scenario drives
//  the gate and the sandbox options of a scripted queryFn; its OS-level cases need bubblewrap and are skipped without it), concurrent
//  producers racing the same document, and any measurement of catch rates, cost effect or model behaviour (all of Phase 4 is scripted).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cli = join(here, '..', '..', '..', '..');

/** Every test title the checklist above cites, by file (as the source spells it: a `${...}` title is a parameterised group). */
const MAPPED: Record<string, string[]> = {
  'writer.e2e.test.ts': [
    "the writer writes inside writes (a real file) and is refused outside; a non-writer's Write, Edit, MultiEdit and NotebookEdit are refused with the core text, one writer-refused event each",
    "a non-writer's shell redirect is stopped at the OS: the sandbox the role was started with, run under the real bubblewrap, makes the workspace read-only",
    'a read-only role whose boundary falls back to an expansion is held at start with writer-boundary-unqualified, a fatal crash, never widened',
    'a second writing section is refused with the text the definition always had',
    'a second role that can change the workspace is refused, naming both roles and the remedy',
    'worktree-per-role together with writes is refused at definition',
  ],
  'budget.e2e.test.ts': [
    'every role runs with its own cap, the table shows the partition, nobody is closed',
    'the section lead and the root are told once at 80 percent; the role cap closes first; the allocation closes the section; a raise reopens it',
    'a replaced incarnation is counted once: the section closes at its allocation, not later',
    'qa closed at its allocation is not woken by a document for it; the notice waits in its inbox and a restart delivers it once',
    '80 percent tells the root and every section lead once; at the ceiling every role is closed softly, new tasks are refused anywhere, a raise reopens',
  ],
  'rework.e2e.test.ts': [
    'the first rejection is relayed, the second spends the cap: one notice to the root and both leads, the producer is refused, the root decides',
    'a reload that raises the cap thaws a frozen thread with no stop; the revision then goes through',
  ],
  'loops.e2e.test.ts': [
    'rounds are counted through inputs; the cap is spent at the second return; the escalation goes out once; a third return is refused; the root decides',
    'a last round that qa accepts ends the loop cleanly: no escalation, no root decision owed',
    'an undeclared cycle between sections is a definition error naming both sections and the remedy',
    'a loop that names an unknown section is refused at start; one that covers no cycle is a warning (it bounds nothing)',
    'loops outside the sections surface is still not supported: it fails at start with the validate text',
  ],
  'lead-rights.e2e.test.ts': [
    'a sections org whose max_concurrent_agents is below its roster is refused at start, naming the remedy; the right cap starts it',
    'a member that does not report to its section lead is a validate warning, not an error',
    'org_task and org_plan_graph across sections are refused with the text; inside a section, to the root and from the root they go through',
    'the cross-section org_send refusal no longer promises a lead-to-lead path: it points at documents and the root',
    'lead-watch: a silent member with an open task, and a message assignment from its lead, tell the SECTION lead',
    'the same roster without sections keeps the reports_to recipient: the root is told, the lead is not',
    'a document nobody reads: the unread watch tells a lead, and the notices of a spent rework cap reach the root and both leads',
  ],
  'crash-resume.e2e.test.ts': [
    'the resume delivers each owed message once, the freeze survives, the root decides, and a third start sends nothing',
    'the escalation goes out once after the resume, the producer is refused straight away, the root decides and the loop ends; a third start sends nothing',
  ],
  'parity.e2e.test.ts': [
    'the miniature sweep without Phase 4 keys produces the P3.14 trail golden; a sections-off org started in the same daemon has no documents and no Phase 4 text',
    'starts every role with the P3.12 prompt, byte for byte, and no Phase 4 line',
    "a Phase 4 org: each role's prompt holds its Phase 4 lines, and the same org with other key values differs by those lines alone",
    'still refused: ${label}',
    'run_config.budget_usd outside the sections surface fails, and so do loops',
  ],
  'reload-guard.e2e.test.ts': [
    'is refused whole and the live org carries on: ${label}',
    'a mixed reload (a raise the guard would allow and a structural key) applies nothing; the same file without the structural key is applied whole',
    'a section allocation (with the org budget), a rework cap and a loop round limit are applied together and act on the documents in flight',
  ],
  'combined.e2e.test.ts': ['the scenario ends in the state its own assertions describe', 'the full trail equals the pinned golden'],
};

/** The cases of each parameterised group, as the source spells their labels. */
const CASES: Record<string, string[]> = {
  'parity.e2e.test.ts': [
    'run_config.max_turn_usd',
    'run_config.allow_unbounded_turn',
    'run_config.budget_mode strict',
    'a token partition in a section budget',
    'sections.<s>.parallelism.max_depth',
    'sections.<s>.mode deliberative',
    'sections.<s>.requests direct',
  ],
  'reload-guard.e2e.test.ts': ['the writing scope changed', 'a section lead changed', 'a loop re-pointed at other types', 'a document contract changed'],
};

const title = (file: string, n: number): string => {
  const t = MAPPED[file]?.[n];
  if (t === undefined) throw new Error(`the checklist names no test ${file} #${n}`);
  return `${file}::${t}`;
};

/** Each acceptance item of 13.2 and of the piece entry, by the tests that prove it (scenario letters as in the header). */
const ACCEPTANCE: Record<string, string[]> = {
  'A single writer': [0, 1, 2, 3, 4, 5].map((n) => title('writer.e2e.test.ts', n)),
  'B section budgets': [0, 1, 2, 3, 4].map((n) => title('budget.e2e.test.ts', n)),
  'C rework rounds': [0, 1].map((n) => title('rework.e2e.test.ts', n)),
  'D loops': [0, 1, 2, 3, 4].map((n) => title('loops.e2e.test.ts', n)),
  'E lead rights': [0, 1, 2, 3, 4, 5, 6].map((n) => title('lead-rights.e2e.test.ts', n)),
  'F crash and resume': [0, 1].map((n) => title('crash-resume.e2e.test.ts', n)),
  'G parity': [0, 1, 2].map((n) => title('parity.e2e.test.ts', n)),
  'H reload guard': [0, 1, 2].map((n) => title('reload-guard.e2e.test.ts', n)),
  'combined run and trail golden': [0, 1].map((n) => title('combined.e2e.test.ts', n)),
  'acceptance 3: each key has a runtime effect or fails validate': [
    title('writer.e2e.test.ts', 0), // writes
    title('budget.e2e.test.ts', 1), // budget
    title('rework.e2e.test.ts', 0), // max_rework_rounds
    title('loops.e2e.test.ts', 0), // loops
    title('loops.e2e.test.ts', 4), // loops off the surface
  ],
  'acceptance 4: the deferred table still fails validate': [title('parity.e2e.test.ts', 3), title('parity.e2e.test.ts', 4)],
};

/** The suites outside this directory that the acceptance list relies on (acceptance 2); each must exist. */
const UNTOUCHED = [
  '__tests__/orgrt/sections-off-golden.test.ts',
  '__tests__/orgrt/frozen-sha-tripwire.test.ts',
  '__tests__/orgrt/context-surface.test.ts',
  '__tests__/orgrt/documents/sections-on-fingerprints.test.ts',
  '__tests__/orgrt/documents/phase4-inert.test.ts',
  '__tests__/orgrt/documents/phase4-inert-pins.test.ts',
  '__tests__/orgrt/documents/phase4-inert-inventory.test.ts',
  '__tests__/orgrt/documents/e2e/sweep-loop.e2e.test.ts',
  '__tests__/orgrt/fixtures/sections-on/e2e-sweep-trail.json',
  '__tests__/orgrt/fixtures/sections-on/prompts.json',
  '__tests__/orgrt/fixtures/phase4/e2e-combined-trail.json',
  'src/__tests__/org-loadouts-default-off.test.ts',
];

const DEFERRED = [
  'requests and answers',
  'blockers with terminal deadlines',
  'pooled admission',
  'per-section token partitions',
  'replacement of a failed lead',
  'pinned verification',
  'merge_owner',
  'deliberative sections',
  'provenance before exposure',
  'completion gates',
  'reload epochs',
];

/** The titles `it(...)` declares in a source file (a quote or a template, unescaped), with `it.skipIf(...)` accepted. */
const titlesIn = (src: string): string[] =>
  [...src.matchAll(/\n\s+it(?:\.skipIf\([^)]*\))?\(\s*(['`])((?:(?!\1)[^\\]|\\.)*)\1/g)].map((m) => m[2].replace(/\\(['`\\])/g, '$1'));

describe('the Phase 4 acceptance checklist', () => {
  it('names only tests that exist, and every e2e test file and every test of it is in the checklist', () => {
    const files = readdirSync(here).filter((f) => f.endsWith('.e2e.test.ts') && f !== 'index.e2e.test.ts');
    expect(files.sort()).toEqual(Object.keys(MAPPED).sort());
    for (const [file, titles] of Object.entries(MAPPED)) {
      const src = readFileSync(join(here, file), 'utf8');
      expect(titlesIn(src).sort(), file).toEqual([...titles].sort());
    }
  });

  it('the cases of each parameterised group are all in the source, and the groups have no others', () => {
    for (const [file, cases] of Object.entries(CASES)) {
      const src = readFileSync(join(here, file), 'utf8');
      for (const c of cases) expect(src, `${file}: ${c}`).toContain(`'${c}'`);
      // the group's table has exactly these labels: a new case must be listed here
      const table = [...src.matchAll(/\n\s+\['((?:[^'\\]|\\.)*)', \(r/g)].map((m) => m[1]);
      expect(table.sort(), file).toEqual([...cases].sort());
    }
  });

  it('the checklist header cites every mapped test and lists every deferred item', () => {
    const header = readFileSync(join(here, 'index.e2e.test.ts'), 'utf8').split('\nimport ')[0];
    for (const titles of Object.values(MAPPED)) for (const t of titles) expect(header, t).toContain(t);
    for (const d of DEFERRED) expect(header.toLowerCase(), d).toContain(d.toLowerCase());
    for (const letter of ['(A)', '(B)', '(C)', '(D)', '(E)', '(F)', '(G)', '(H)']) expect(header, letter).toContain(`P4.12 ${letter}`);
  });

  it('every acceptance item points at tests that exist, and every mapped test proves at least one item', () => {
    const named = new Set(Object.values(ACCEPTANCE).flat());
    const all = Object.entries(MAPPED).flatMap(([f, ts]) => ts.map((t) => `${f}::${t}`));
    for (const [item, tests] of Object.entries(ACCEPTANCE)) {
      expect(tests.length, item).toBeGreaterThan(0);
      for (const t of tests) expect(all, `${item}: ${t}`).toContain(t);
    }
    expect(all.filter((t) => !named.has(t))).toEqual([]);
  });

  it('the suites and fixtures the acceptance list relies on exist', () => {
    for (const f of UNTOUCHED) expect(existsSync(join(cli, f)), f).toBe(true);
  });
});
