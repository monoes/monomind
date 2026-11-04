/**
 * The skill-library pieces the catalog needs too: where org skills live and
 * how a SKILL.md's frontmatter is read. Moved out of orgrt/skill-library.ts
 * (which re-exports them) so catalog/ and the Org Runtime share them without
 * an import cycle.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Which root a skill was found in (orgrt/skill-library.ts SkillMeta.origin). */
export type SkillOrigin = 'project' | 'user' | 'bundled' | 'catalog';

/** Shipped library: <package-root>/org-skills, from dist/src/orgrt or src/orgrt. */
export function bundledSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const built = join(here, '..', '..', '..', 'org-skills');
  return existsSync(built) ? built : join(here, '..', '..', 'org-skills');
}

export function skillRoots(projectRoot?: string): { dir: string; origin: SkillOrigin }[] {
  const roots: { dir: string; origin: SkillOrigin }[] = [];
  if (projectRoot)
    roots.push({ dir: join(projectRoot, '.monomind', 'org-skills'), origin: 'project' });
  roots.push({
    dir: join(process.env.MONOMIND_HOME ?? join(homedir(), '.monomind'), 'org-skills'),
    origin: 'user',
  });
  roots.push({ dir: bundledSkillsDir(), origin: 'bundled' });
  return roots;
}

/**
 * Minimal frontmatter reader for top-level scalar and list keys. Handles
 * `key: value`, quoted values, JSON/flow lists (`[a, b]`), block lists
 * (`- a`), and folded/literal block scalars (`>` / `|`). Nested maps are
 * skipped — nothing here needs them.
 */
export function parseFrontmatter(text: string): {
  data: Record<string, string | string[]>;
  body: string;
} {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string | string[]> = {};
  const lines = m[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    // `(?=(\s*))\2` takes the spaces atomically: no quadratic backtracking.
    const kv = /^([A-Za-z_][\w-]*):(?=(\s*))\2(.*)$/.exec(lines[i]);
    if (!kv) continue;
    const [, key, , raw] = kv;
    const val = raw.trim();
    const cont: string[] = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
      cont.push(lines[++i]);
    }
    if (val === '' && cont.some((l) => /^\s*-\s+/.test(l))) {
      data[key] = cont
        .filter((l) => /^\s*-\s+/.test(l))
        .map((l) => unquote(l.replace(/^\s*-\s+/, '')));
    } else if (/^[>|][+-]?$/.test(val)) {
      const parts = cont.map((l) => l.trim());
      data[key] = (val.startsWith('>') ? parts.join(' ') : parts.join('\n')).trim();
    } else if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = val
        .slice(1, -1)
        .split(',')
        .map((s) => unquote(s.trim()))
        .filter(Boolean);
    } else if (val !== '') {
      // A plain scalar may wrap onto indented continuation lines.
      const nested = cont.some((l) => /^\s+[\w-]+:/.test(l));
      data[key] = unquote([val, ...(nested ? [] : cont.map((l) => l.trim()))].join(' ').trim());
    }
  }
  return { data, body: text.slice(m[0].length) };
}

function unquote(s: string): string {
  if (s.length >= 2 && s[0] === '"' && s.at(-1) === '"') {
    try {
      return JSON.parse(s) as string;
    } catch {
      return s.slice(1, -1);
    }
  }
  if (s.length >= 2 && s[0] === "'" && s.at(-1) === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}
