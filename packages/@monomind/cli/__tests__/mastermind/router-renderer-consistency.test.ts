import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLATFORM_IDS, PLATFORM_REGISTRY } from '../../src/platform-adapters/registry.js';
import { renderSkillRouter } from '../../src/platform-adapters/renderers/skills.js';
import { getMastermindSkillSourceDir, MASTERMIND_SKILLS, resolveMastermindSkill } from '../../src/mastermind/manifest.js';

/**
 * o-09: `renderSkillRouter()` special-cased the `'mastermind'` package to a
 * separate generator, `portableSkillRouter()`, instead of reading the real
 * curated `mastermind/SKILL.md` the way every other Mastermind skill does
 * (`renderSkillPackage()`). The generator built its list from
 * `MASTERMIND_SKILLS`, which never listed `mastermind-idea` or
 * `mastermind-design` — two gates the curated file itself calls mandatory —
 * so every platform with native skill support shipped a router that
 * contradicted its own curated source, silently, on every `init`/`init
 * --force`. Deleting the stale block in the curated file alone (o-09's first
 * pass) did not fix this: the generator re-appended it on the next install.
 *
 * These are the two checks that actually catch that class of defect —
 * "the repo file looks right" is not "what a platform actually renders".
 */
describe('the mastermind router renderer agrees with the curated file (o-09)', () => {
  const sourceDir = getMastermindSkillSourceDir();
  const curatedRouter = sourceDir ? readFileSync(join(sourceDir, 'mastermind', 'SKILL.md'), 'utf8') : null;

  it('a curated mastermind/SKILL.md is actually findable — the guard below cannot silently no-op', () => {
    expect(sourceDir, 'getMastermindSkillSourceDir() returned nothing').toBeTruthy();
    expect(curatedRouter).toBeTruthy();
  });

  // Every adapter registered as shipping native skill support, checked
  // individually rather than sampling one, because the special case this
  // guards against was adapter-agnostic (it fired for all of them equally,
  // which is exactly how it went unnoticed).
  const nativeSkillAdapterIds = PLATFORM_IDS.filter((id) => PLATFORM_REGISTRY[id].capabilities.skills === 'native');

  it('at least one adapter actually ships native skills — the loop below is not vacuous', () => {
    expect(nativeSkillAdapterIds.length).toBeGreaterThan(0);
  });

  it.each(nativeSkillAdapterIds)(
    'renders the mastermind router for %s identically to the curated file',
    (id) => {
      const intents = renderSkillRouter(PLATFORM_REGISTRY[id], 'project');
      const routerIntent = intents.find((i) => i.relativePath === join('mastermind', 'SKILL.md'));
      // dev-lead round-2 MINOR 1: an early `return` here silently passed for
      // an adapter that produced no router intent — unreachable today
      // (verified: all 11 native-skill adapters produce one), but the guard
      // above only checks the registry's `capabilities.skills === 'native'`
      // flag, not that an intent actually came out the other end. A real
      // future regression (an adapter added to the registry as 'native' but
      // never wired into renderSkillRouter()) would have passed silently
      // instead of failing loudly.
      expect(routerIntent, `${id} produced no mastermind/SKILL.md router intent`).toBeTruthy();
      expect(routerIntent?.content).toBe(curatedRouter);
    },
  );
});

describe('MASTERMIND_SKILLS lists every workflow the curated router names as mandatory (o-09)', () => {
  const sourceDir = getMastermindSkillSourceDir();
  const curatedRouter = sourceDir ? readFileSync(join(sourceDir, 'mastermind', 'SKILL.md'), 'utf8') : '';

  // The curated router's own bullet list — `- \`mastermind-x\` ...` — is the
  // file's own declaration of which workflows it routes to. Extracted rather
  // than hardcoded so this test tracks the file, not a copy of it.
  const namedWorkflows = [...curatedRouter.matchAll(/^- `(mastermind-[\w-]+)`/gm)].map((m) => m[1]);

  it('finds a non-trivial workflow list in the curated file — the extraction above is not silently empty', () => {
    expect(namedWorkflows.length).toBeGreaterThanOrEqual(9);
  });

  it.each(namedWorkflows)('%s named by the curated router has a MASTERMIND_SKILLS entry', (name) => {
    expect(resolveMastermindSkill(name)?.name, `${name} is named in the router but absent from MASTERMIND_SKILLS`).toBe(
      name,
    );
  });

  it('every non-router MASTERMIND_SKILLS entry is named by the curated router', () => {
    const manifestNames = MASTERMIND_SKILLS.map((s) => s.name).filter((n) => n !== 'mastermind');
    const orphaned = manifestNames.filter((n) => !namedWorkflows.includes(n));
    expect(orphaned, 'MASTERMIND_SKILLS lists a workflow the curated router text does not mention').toEqual([]);
  });
});
