// packages/@monomind/cli/__tests__/orgrt/documents/phase4-inert-inventory.test.ts
//
// Org sections P4.0 (spec 13.2), part 3 of 3: the inventory. Phase 4 gives effect to `writes` (P4.4),
// `max_rework_rounds` (P4.7), `loops` (P4.8, with `parallelism` listed beside them because P4.0's plan names
// it) and, for the budget keys, to `budget`. A fixture or test definition that ALREADY sets one of them
// would change behaviour the day its piece lands. This test lists every such use in the repo's test trees and
// pins the exact set, so a new use is noticed and a piece that gives a key effect knows which fixtures to re-pin.
//
// Scanned: `tests/` (this includes the eval pilot manifests under tests/eval/org/pilot and tests/eval/org/manifests,
// the eval fixtures and the pilot-to-runtime definition golden), `packages/@monomind/cli/__tests__/` and
// `packages/@monomind/cli/src/__tests__/`. node_modules, dist, .claude and worktrees are skipped.
//   Layer 1, structure: every .json file is parsed; a hit is a `sections.<s>` object that has `writes`,
//     `max_rework_rounds` or `parallelism`, or an object that has `loops` next to `roles` or `sections`
//     (an org definition). The pilot manifests and the runtime definition golden are caught here.
//   Layer 2, text: a .ts/.mjs/.js/.cjs/.json file that mentions `sections` and has one of the four names used as a
//     key or assigned (`name:`, `.name =`, `"name":`); the pinned value is the count per key and file.
// The three phase4-inert*.test.ts files are not scanned: they name the keys on purpose.
//
// HOW A DELIBERATE CHANGE IS MADE. A new hit means a new test or fixture uses one of the keys: add it to
// EXPECTED_TEXT with a comment on why. A piece that gives a key effect (P4.4 `writes`, P4.7 `max_rework_rounds`,
// P4.8 `loops`) adds its new test files to EXPECTED_TEXT in the same commit and lists them in its report; it
// must not edit another piece's line. Result at P4.0: no JSON definition and no pilot manifest sets any of the
// four keys; the only uses are the mutation tests of definition.test.ts, the `loops` refusals of the sections-off
// goldens and checklist tests, and nothing else.
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..', '..');
const ROOTS = ['tests', 'packages/@monomind/cli/__tests__', 'packages/@monomind/cli/src/__tests__'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.claude', 'worktrees']);
const SELF = /\/documents\/phase4-inert[a-z-]*\.test\.ts$/;
const KEYS = ['writes', 'max_rework_rounds', 'parallelism', 'loops'] as const;
const SECTION_KEYS = ['writes', 'max_rework_rounds', 'parallelism'];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) listFiles(p, out);
    else out.push(p);
  }
  return out;
}

const FILES = ROOTS.flatMap((r) => listFiles(join(REPO, r)))
  .filter((f) => !SELF.test(f))
  .map((f) => ({ abs: f, rel: relative(REPO, f) }));

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Layer 1: JSON pointers of every org-definition-shaped hit in a parsed value. */
function structuralHits(v: unknown, path: string, out: string[]): void {
  if (Array.isArray(v)) v.forEach((x, i) => structuralHits(x, `${path}/${i}`, out));
  else if (isObj(v)) {
    if ('loops' in v && ('roles' in v || 'sections' in v)) out.push(`${path}/loops`);
    if (isObj(v.sections))
      for (const [name, sec] of Object.entries(v.sections))
        if (isObj(sec)) for (const k of SECTION_KEYS) if (k in sec) out.push(`${path}/sections/${name}/${k}`);
    for (const [k, x] of Object.entries(v)) structuralHits(x, `${path}/${k}`, out);
  }
}

const KEY_RE = new RegExp(`(?:\\.|['"]|\\b)(${KEYS.join('|')})['"]?\\s*(?::|=(?![=>]))`, 'g');
const SECTIONS_RE = /\bsections\s*[:=.[]|["']sections["']/;

/** Layer 2: key -> count, for a source text that mentions `sections`. */
function textHits(text: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!SECTIONS_RE.test(text)) return counts;
  for (const m of text.matchAll(KEY_RE)) counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  return counts;
}

const P = 'packages/@monomind/cli/__tests__/orgrt';

// Layer 1 result at P4.0: one hit, and it is not a definition. The frozen sections-off checklist golden records the
// findings of a variant named "loops" next to a variant named "roles" under "deferred"; no org sets the key.
const EXPECTED_STRUCTURE: Record<string, string[]> = {
  [`${P}/fixtures/sections-off/checklist-findings.json`]: ['/deferred/loops'],
};

// The exact set at P4.0. Keys within a file are listed in alphabetical order.
const EXPECTED_TEXT: Record<string, Record<string, number>> = {
  // The mutation cases of the P3.1 definition check (a writer pair, a bad writes value, a zero rework cap, max_depth, max_parallel).
  // P4.4 and P4.7 add their own test files here; they do not re-pin this one unless a message it checks changes.
  [`${P}/documents/definition.test.ts`]: { max_rework_rounds: 2, parallelism: 2, writes: 4 },
  // P4.3 (pure loops core): `loops` in literal definition fragments given to loopProblems, and the cap key in capsFromDef cases.
  // Neither feeds validate or a run: nothing imports the loops files yet. P4.8 does not re-pin these.
  [`${P}/documents/loops-rounds.test.ts`]: { max_rework_rounds: 5 },
  [`${P}/documents/loops.test.ts`]: { loops: 3 },
  // `loops` as a refused key: surface on, checklist.
  [`${P}/documents/validate-checklist-sections.test.ts`]: { loops: 2 },
  // `loops` as a refused key: the sections-off checklist golden (a variant named "loops", frozen) and its test.
  [`${P}/fixtures/sections-off/checklist-findings.json`]: { loops: 1 },
  [`${P}/sections-off-golden.test.ts`]: { loops: 2 },
  // `loops` through a project file on disk, sections off.
  [`${P}/validate-checklist-paths.test.ts`]: { loops: 1 },
  // P4.2 writer core (pure): definitions that declare `writes` (and one `parallelism`) to test the single-writer rules.
  [`${P}/documents/writer-policy-engine.test.ts`]: { writes: 1 },
  [`${P}/documents/writer-policy.test.ts`]: { parallelism: 1, writes: 14 },
  [`${P}/documents/writer-property.test.ts`]: { writes: 4 },
  [`${P}/support/writer-defs.ts`]: { writes: 1 },
};

describe('phase4 inert: fixture inventory', () => {
  it('the walk found the trees it is meant to scan (a broken walker must not pass as an empty inventory)', () => {
    const rels = new Set(FILES.map((f) => f.rel));
    expect(FILES.length).toBeGreaterThan(500);
    for (const known of [
      `${P}/documents/definition.test.ts`,
      `${P}/documents/validate-checklist-sections.test.ts`,
      'tests/eval/org/pilot/parallel-sweep-3.pilot.json',
      'tests/eval/org/pilot/dev-feature-qa-revise.pilot.json',
      'tests/eval/org/pilot/fixtures/runtime-def-sweep3-v2.json',
      'tests/eval/org/manifests/parallel-sweep-3.json',
      'packages/@monomind/cli/src/__tests__/org-loadouts-default-off.test.ts',
    ])
      expect(rels.has(known), known).toBe(true);
    // No file of a skipped tree was walked.
    expect(FILES.filter((f) => /\/(node_modules|dist|worktrees)\//.test(f.rel))).toEqual([]);
  });

  it('no JSON definition, fixture or pilot manifest sets writes, max_rework_rounds, parallelism or loops on an org (one recorded refusal aside)', () => {
    const hits: Record<string, string[]> = {};
    for (const f of FILES) {
      if (!f.rel.endsWith('.json')) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(f.abs, 'utf8'));
      } catch {
        continue; // not strict JSON (a template); layer 2 still reads its text
      }
      const found: string[] = [];
      structuralHits(parsed, '', found);
      if (found.length > 0) hits[f.rel] = found;
    }
    expect(hits).toEqual(EXPECTED_STRUCTURE);
  });

  it('the pilot manifests and the pilot-to-runtime definition golden name none of the four keys as a key', () => {
    const pilot = FILES.filter(
      (f) => /^tests\/eval\/org\/(pilot|manifests|fixtures)\/.*\.json$/.test(f.rel),
    );
    expect(pilot.length).toBeGreaterThanOrEqual(8);
    const counts = Object.fromEntries(pilot.map((f) => [f.rel, textHits(readFileSync(f.abs, 'utf8'))]));
    for (const [rel, c] of Object.entries(counts)) expect(c, rel).toEqual({});
  });

  it('every test or fixture that sets one of the four keys on a sections definition is listed, and nothing else', () => {
    const got: Record<string, Record<string, number>> = {};
    for (const f of FILES) {
      if (!/\.(ts|mjs|js|cjs|json)$/.test(f.rel)) continue;
      const c = textHits(readFileSync(f.abs, 'utf8'));
      if (Object.keys(c).length > 0) got[f.rel] = Object.fromEntries(Object.entries(c).sort(([a], [b]) => (a < b ? -1 : 1)));
    }
    expect(got).toEqual(EXPECTED_TEXT);
  });

  it('no sections-on fixture of Phase 3 (the e2e trail, the P3.12 prompts and tool descriptions, the pilot runtime definition) sets one of the keys', () => {
    const sectionsOn = FILES.filter(
      (f) => /\/fixtures\/(sections-on|phase4)\//.test(f.rel) || f.rel === 'tests/eval/org/pilot/fixtures/runtime-def-sweep3-v2.json',
    );
    expect(sectionsOn.length).toBeGreaterThanOrEqual(4);
    for (const f of sectionsOn) expect(textHits(readFileSync(f.abs, 'utf8')), f.rel).toEqual({});
  });
});
