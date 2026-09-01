// packages/@monomind/cli/__tests__/orgrt/role-skills.test.ts
//
// Drift guard: every archetype id defined in scripts/generate-agent-avatars.mjs
// (the source of truth for the 118-icon manifest MonoAgent's Org Designer
// palette ships — the manifest itself is a generated output, not source)
// must have a matching best-practices file under src/orgrt/role-skills/, so
// a future archetype addition can't silently ship with no bundled content.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const generatorPath = join(here, '../../../../../scripts/generate-agent-avatars.mjs');
const roleSkillsDir = join(here, '../../src/orgrt/role-skills');

/** Extracts unique archetype ids from the AGENTS array literal, the same
 *  way this feature's own content-generation pass did — object-chunk regex
 *  over `{ id: '...', label: '...', cat: '...' }` entries, stopping before
 *  the `-v<N>` synthetic-padding loop so padding entries (not real
 *  archetypes) aren't counted. */
function extractArchetypeIds(source: string): string[] {
  const start = source.indexOf('const AGENTS');
  const end = source.indexOf('while (AGENTS.length');
  const block = source.slice(start, end);
  const ids = new Set<string>();
  for (const m of block.matchAll(/\{([^{}]*)\}/g)) {
    const idMatch = /id:\s*'([^']+)'/.exec(m[1]);
    if (idMatch) ids.add(idMatch[1]);
  }
  return [...ids];
}

describe('role-skills bundled content', () => {
  it('generator script is where we expect (fails loudly if it moves, rather than silently skipping the drift check)', () => {
    expect(existsSync(generatorPath)).toBe(true);
  });

  it('every archetype id in generate-agent-avatars.mjs has a matching role-skills/<id>.md', () => {
    const source = readFileSync(generatorPath, 'utf-8');
    const ids = extractArchetypeIds(source);
    expect(ids.length).toBeGreaterThan(50); // sanity check the extraction itself isn't silently matching nothing

    const missing = ids.filter((id) => !existsSync(join(roleSkillsDir, `${id}.md`)));
    expect(missing).toEqual([]);
  });

  it('every role-skills/*.md file is non-trivial (not an empty/near-empty stub)', async () => {
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(roleSkillsDir).filter((f) => f.endsWith('.md'));
    expect(files.length).toBeGreaterThan(50);
    const tooShort = files.filter((f) => readFileSync(join(roleSkillsDir, f), 'utf-8').trim().length < 200);
    expect(tooShort).toEqual([]);
  });
});
