/**
 * The shipped `release` org: a sections org whose roles pin one small shared rules skill plus their
 * own task skills, and hand work over as schema-validated documents.
 *
 * #273: the org's SETUP and CLEAN UP steps once told the coordinator to "empty {{home}}/mrg-tmp"
 * — the shared TMPDIR every role (and the agent harness's own per-session sandbox bridge) writes
 * into. During the 2.11.1 run, `find {{home}}/mrg-tmp -mindepth 1 -delete` deleted the live socket
 * of the session running it and permanently broke that role's Bash tool for the rest of the
 * ~4 hour run. The shipped config and skills must never instruct a role to empty a directory that
 * holds its own scratch or any live run's.
 *
 * Instructions live in two places now: each role's `responsibilities` and the `release-*` org
 * skills under `.monomind/org-skills`, so every guard below reads both.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../packages/@monomind/cli/src/orgrt/validate-checklist.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const configPath = join(repoRoot, 'config', 'orgs', 'release.json');
const raw = readFileSync(configPath, 'utf8');

const skill = (name: string): string =>
  readFileSync(join(repoRoot, '.monomind', 'org-skills', name, 'SKILL.md'), 'utf8');
const bodyBytes = (name: string): number =>
  Buffer.byteLength(skill(name).replace(/^---[\s\S]*?---\n/, ''));

/** A blanket-wipe phrasing only counts as an instruction when it is not
 *  being forbidden — the config names these commands in order to ban them. */
const forbiddenNearby = (line: string, at: number): boolean =>
  /\b(?:no|not|never)\b[^.]{0,40}$/i.test(line.slice(Math.max(0, at - 60), at));

interface Role {
  id: string;
  type?: string;
  reports_to?: string | null;
  responsibilities?: string[];
  skills?: string[];
  skill_pool?: string[];
  adapter_config?: { model?: string };
  policy?: Record<string, unknown>;
}
interface Def {
  name: string;
  roles: Role[];
  sections: Record<
    string,
    {
      lead: string;
      members: string[];
      consumes?: string[];
      publishes?: string[];
      max_rework_rounds?: number;
    }
  >;
  documents: Record<string, { schema: unknown; evidence?: unknown[]; visibility?: string }>;
  run_config: Record<string, unknown>;
}

const def = JSON.parse(raw) as Def;
const role = (id: string): string =>
  (def.roles.find((r) => r.id === id)?.responsibilities ?? []).join('\n');

const SKILL_NAMES = [
  'monomind-release-rules',
  'release-scratch',
  'release-commit',
  'release-captain-ops',
  'release-closeout',
  'release-preflight-setup',
  'release-integrate-prep',
  'release-publish',
];

describe('release org config', () => {
  it('is valid JSON with the expected roles', () => {
    expect(def.name).toBe('release');
    expect(def.roles.map((r) => r.id)).toEqual([
      'release-captain',
      'builder',
      'cli-qa',
      'integration-qa',
      'runtime-qa',
      'maintainer',
      'fixer',
      'docs-writer',
      'publisher',
      'release-auditor',
    ]);
  });

  it('the tracked twin in .monomind/orgs is byte-identical', () => {
    const twin = readFileSync(join(repoRoot, '.monomind', 'orgs', 'release.json'), 'utf8');
    expect(twin).toBe(raw);
  });

  /** Every instruction a role can be given: its responsibilities and every release skill. */
  const instructionLines = (): string[] => [
    ...def.roles.flatMap((r) => (r.responsibilities ?? []).map((line) => `${r.id}: ${line}`)),
    ...SKILL_NAMES.flatMap((n) =>
      skill(n)
        .split('\n')
        .map((line) => `${n}: ${line}`),
    ),
  ];
  const SHARED_TMPDIR = '(?:\\{\\{home\\}\\}|\\$HOME)/mrg-tmp';

  it('never tells a role to empty or recursively delete the shared TMPDIR root', () => {
    const wipePatterns = [
      new RegExp(`empty\\s+(?:it\\s+)?${SHARED_TMPDIR}(?![\\w/-])`, 'gi'),
      new RegExp(`rm\\s+-rf\\s+${SHARED_TMPDIR}(?:/\\*)?(?![\\w/-])`, 'g'),
      new RegExp(`${SHARED_TMPDIR}\\s+-mindepth\\s+1\\s+-delete`, 'g'),
    ];
    const offenders = instructionLines().filter((line) =>
      wipePatterns.some((re) => {
        re.lastIndex = 0;
        for (let m = re.exec(line); m; m = re.exec(line)) {
          if (!forbiddenNearby(line, m.index)) return true;
        }
        return false;
      }),
    );
    expect(offenders).toEqual([]);
  });

  it('spells out the narrow, run-scoped pruning rule instead', () => {
    const all = instructionLines().join('\n');
    expect(all).toMatch(/#273/);
    // Both halves: never the root, only this org's own run-scoped subdirectories.
    expect(all).toMatch(new RegExp(`never .{0,120}${SHARED_TMPDIR}`, 'i'));
    expect(all).toMatch(/short-sha/i);
  });

  describe('startup context', () => {
    it('pins the small shared core to every role and nothing from the heavy skills', () => {
      for (const r of def.roles) {
        expect(r.skills?.[0], r.id).toBe('monomind-release-rules');
        for (const heavy of [
          'release-closeout',
          'release-preflight-setup',
          'release-integrate-prep',
          'release-publish',
        ]) {
          expect(r.skills, `${r.id} pins ${heavy}`).not.toContain(heavy);
        }
      }
      expect(bodyBytes('monomind-release-rules')).toBeLessThan(5500);
    });

    it('keeps each role below a pinned-skill budget', () => {
      for (const r of def.roles) {
        const pinned = (r.skills ?? []).reduce((n, s) => n + bodyBytes(s), 0);
        expect(pinned, r.id).toBeLessThan(11_000);
      }
    });

    it('no role pins a generic library skill: they are on demand', () => {
      for (const r of def.roles)
        for (const s of r.skills ?? []) expect(SKILL_NAMES, `${r.id}: ${s}`).toContain(s);
    });

    it('every role keeps its explicit, current Sonnet pin', () => {
      for (const r of def.roles) {
        expect(r.adapter_config?.model, r.id).toBe('claude-sonnet-5-5');
        expect(JSON.stringify(r)).not.toMatch(/fable|astra/i);
      }
    });
  });

  describe('sections and documents', () => {
    it('validates on the sections surface with no errors', () => {
      const parsed = OrgDefSchema.parse(def);
      const f = checklistFindings(parsed);
      expect(f.errors).toEqual([]);
      // The only warning left is "no checks declared": the checks dialect covers answer sheets only.
      expect(f.warnings.filter((w) => !/no checks declared/.test(w))).toEqual([]);
    });

    it('puts every non-root role in exactly one section led by a role that reports to the root', () => {
      const seen = new Map<string, string>();
      for (const [name, s] of Object.entries(def.sections))
        for (const m of s.members) {
          expect(seen.has(m), `${m} in two sections`).toBe(false);
          seen.set(m, name);
        }
      const nonRoot = def.roles.filter((r) => r.type !== 'boss').map((r) => r.id);
      expect([...seen.keys()].sort()).toEqual([...nonRoot].sort());
      for (const s of Object.values(def.sections))
        expect(def.roles.find((r) => r.id === s.lead)?.reports_to).toBe('release-captain');
    });

    it('caps rework on every section', () => {
      for (const [name, s] of Object.entries(def.sections))
        expect(s.max_rework_rounds, name).toBeGreaterThan(0);
    });

    it('gives every record an evidence requirement and org visibility', () => {
      for (const [type, c] of Object.entries(def.documents)) {
        expect(c.evidence?.length, type).toBeGreaterThan(0);
        expect(c.visibility, type).toBe('org');
      }
    });

    it('lets only publisher decide the verdict that gates PUBLISH, and the auditor decide the release commit', () => {
      expect(def.sections.ship.consumes).toContain('audit-verdict');
      expect(def.sections.audit.consumes).toEqual(['prep-record']);
      expect(def.sections.audit.publishes).toEqual(['audit-verdict']);
      expect(role('publisher')).toMatch(/newest accepted final `audit-verdict` says APPROVE/);
    });

    it('keeps the sandbox policies: denyWrite for QA and audit, allowWrite for the shared scratch', () => {
      for (const id of ['cli-qa', 'integration-qa', 'runtime-qa', 'release-auditor']) {
        const sb = (
          def.roles.find((r) => r.id === id)?.policy as {
            sandbox?: { mode?: string; denyWrite?: string[] };
          }
        ).sandbox;
        expect(sb?.mode, id).toBe('required');
        expect(sb?.denyWrite, id).toEqual(['.']);
      }
      for (const r of def.roles) {
        const allow = (r.policy as { sandbox?: { allowWrite?: string[] } }).sandbox?.allowWrite;
        expect(allow, r.id).toEqual(['{{home}}/monomind-release', '{{home}}/mrg-tmp']);
      }
      expect(def.run_config.completion_evidence).toBe(true);
    });
  });

  /** Parallel sessions (2026-09-26, 2.16.7 … 2.16.12 released back to back). */
  describe('parallel sessions', () => {
    const ops = skill('release-captain-ops');
    const closeout = skill('release-closeout');
    const preflight = skill('release-preflight-setup');
    const publish = skill('release-publish');

    it('gates agent trials on a verified Claude SDK before SETUP (#592)', () => {
      expect(role('release-captain')).toMatch(/PREFLIGHT —/);
      expect(role('release-captain')).toContain('release-preflight-setup');
      expect(role('release-captain')).toContain('monomind deps install');
      expect(preflight).toContain(
        'MONOMIND_NO_AUTO_INSTALL=1 monomind agent models --runtime claude --json',
      );
      expect(preflight).toContain('monomind deps install');
      expect(preflight).toMatch(/outside any org role/);
      expect(preflight).toMatch(/never SKIP/);
      expect(preflight).toMatch(/No SETUP and no live Claude trial/);
    });

    it('captain takes the release lock before PREFLIGHT and releases it in CLEAN UP', () => {
      const captain = role('release-captain');
      expect(captain.indexOf('RELEASE LOCK')).toBeGreaterThan(-1);
      expect(captain.indexOf('RELEASE LOCK')).toBeLessThan(captain.indexOf('PREFLIGHT —'));
      expect(closeout).toMatch(/release the release lock[^.]*and `org_complete`/);
      expect(ops).toMatch(/node scripts\/release-lock\.mjs acquire --runtime /);
      expect(ops).toMatch(/node scripts\/release-lock\.mjs release --runtime /);
      expect(ops).toMatch(
        /exit 3[\s\S]{0,400}`org_complete` outcome `partial`, blocker `external`/,
      );
    });

    it('a version named in the task is reported when it differs, never treated as an error', () => {
      expect(ops).toMatch(/VERSION: task named X, npm already has Y, releasing Z/);
      expect(preflight).toMatch(/VERSION: task named X, npm already has Y, releasing Z/);
      expect(role('release-captain')).not.toMatch(/if the task states one, use it\. /);
    });

    it('the release number goes only into the two release packages (#636)', () => {
      expect(ops).toMatch(/exactly two packages: root `monomind` and `@monoes\/monomindcli`/);
      expect(ops).toMatch(/never set MONOMIND_ALLOW_MAJOR_BUMP/);
    });

    it('local main sync merges with the CHANGELOG.md driver and never rewrites the owner commits', () => {
      expect(publish).toMatch(
        /-c merge\.monomind-changelog\.driver="node SRC\/scripts\/merge-changelog\.mjs %O %A %B"/,
      );
      expect(publish).toMatch(/Never rebase, reset, amend or cherry-pick local main's commits/);
      expect(role('publisher')).not.toMatch(/git merge --no-ff origin\/main/);
      expect(role('publisher')).toMatch(/LOCAL MAIN SYNC[^.]*`release-publish`/);
    });

    it('local main sync probes for a writable CLI package root and otherwise hands the operator the command (#667)', () => {
      expect(publish).toMatch(/WRITE PROBE FIRST/);
      expect(publish).toMatch(
        /test -w ORG_ROOT\/packages\/@monomind\/cli\/package\.json && test -w ORG_ROOT\/\.claude && test -w ORG_ROOT\/\.monomind\/org-skills/,
      );
      expect(publish).toMatch(/LOCAL MAIN SYNC PENDING \(operator\)/);
      expect(closeout).toMatch(/LOCAL MAIN SYNC PENDING/);
    });

    it('publish keeps its safety gates: GO verdict, approving audit, ordered, never forced', () => {
      expect(publish).toMatch(/verdict\.json[\s\S]{0,200}says GO for the same SHA as SRC HEAD/);
      expect(publish).toMatch(/newest accepted `audit-verdict` \(kind final\) says APPROVE/);
      expect(publish).toMatch(
        /NEVER publish `monomind` before its exactly-pinned CLI version is confirmed/,
      );
      expect(publish).toMatch(/never force/);
      expect(publish).toMatch(/never unpublish/);
      expect(role('publisher')).toMatch(/never `--force` or force-push, never unpublish/);
      expect(skill('release-captain-ops')).toMatch(/blocks GO unless proven a pre-existing flake/);
      expect(closeout).toMatch(/GitHub `Tests` gate passed/);
    });
  });

  /** Cross-run lessons: findings become org memory that later runs recall. */
  describe('cross-run lessons', () => {
    const ops = skill('release-captain-ops');

    it('captain records QA/auditor findings and operator interventions as deduplicated lessons', () => {
      expect(ops).toMatch(/\*\*Lessons across runs\.\*\*/);
      expect(ops).toMatch(/First `org_recall` `lesson <area> <key words>`/);
      expect(ops).toMatch(/`org_remember` scope `org`/);
      expect(ops).toMatch(
        /every FAIL from builder or a QA role, every release-auditor REJECT and every operator intervention/,
      );
    });

    it('every task role recalls lessons at the start of each task', () => {
      expect(skill('monomind-release-rules')).toMatch(/`org_recall` `lesson <area>`/);
      for (const id of [
        'maintainer',
        'fixer',
        'docs-writer',
        'cli-qa',
        'integration-qa',
        'runtime-qa',
      ])
        expect(role(id), id).toMatch(/lessons recall/i);
    });

    it('REPORT.md only proposes permanent rules', () => {
      expect(ops).toMatch(/## Lessons/);
      expect(ops).toMatch(/Propose, never apply: never edit a skill or an org config yourself/);
    });
  });
});
