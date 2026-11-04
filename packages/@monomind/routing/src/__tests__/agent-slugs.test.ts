/**
 * Every route must name an agent Claude Code can spawn: its agentSlug is the
 * `name` in an agent file's frontmatter under the CLI's bundled
 * .claude/agents tree (the Task tool's subagent_type).
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_KEYWORD_ROUTES } from '../keyword-pre-filter.js';
import { ALL_ROUTES } from '../routes/index.js';

const AGENTS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'cli',
  '.claude',
  'agents',
);

/** Frontmatter names marked `deprecated: true` (the picker hides them). */
const DEPRECATED = new Set<string>();

function isDeprecated(frontmatter: string): boolean {
  return /^deprecated:\s*true\s*$/m.test(frontmatter);
}

function agentNames(dir: string): Set<string> {
  const names = new Set<string>();
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const n of agentNames(file)) names.add(n);
    } else if (entry.name.endsWith('.md')) {
      const fm = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/);
      const name = fm?.[1]
        .match(/^name:\s*(.+)$/m)?.[1]
        .trim()
        .replace(/^["']|["']$/g, '');
      if (name) names.add(name);
      if (name && isDeprecated(fm?.[1] ?? '')) DEPRECATED.add(name);
    }
  }
  return names;
}

describe('route agents are real, spawnable agents', () => {
  const names = agentNames(AGENTS_DIR);

  it('finds the bundled agent registry', () => {
    expect(names.has('coder')).toBe(true);
    expect(names.size).toBeGreaterThan(50);
  });

  it('every ALL_ROUTES agentSlug is an agent frontmatter name', () => {
    const unknown = ALL_ROUTES.map((r) => r.agentSlug).filter((s) => !names.has(s));
    expect(unknown).toEqual([]);
  });

  it('every DEFAULT_KEYWORD_ROUTES agentSlug is an agent frontmatter name', () => {
    const unknown = DEFAULT_KEYWORD_ROUTES.map((r) => r.agentSlug).filter((s) => !names.has(s));
    expect(unknown).toEqual([]);
  });

  it('no route names a deprecated agent', () => {
    // The registry may hold no deprecated agent (the last four were removed),
    // so prove the marker is detected on a sample instead of on the registry.
    expect(isDeprecated('name: old-agent\ndeprecated: true')).toBe(true);
    expect(isDeprecated('name: coder\ndescription: deprecated: true is not a key')).toBe(false);
    const slugs = [...ALL_ROUTES, ...DEFAULT_KEYWORD_ROUTES].map((r) => r.agentSlug);
    expect(slugs.filter((s) => DEPRECATED.has(s))).toEqual([]);
  });
});
