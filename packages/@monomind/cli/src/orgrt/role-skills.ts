/**
 * Built-in role-archetype best-practices content, keyed by the archetype id
 * a client (e.g. MonoAgent's Org Designer) stamps into a role's
 * `ui.icon` when the role is created from one of the bundled palette
 * icons (see `role-skills/<id>.md`, one file per archetype — sourced from
 * this repo's own `.claude/agents/*.md` personas where a good match
 * existed, researched fresh otherwise).
 *
 * Deliberately keyed off `ui.icon`, not a new schema field: `ui.icon`
 * already carries the archetype id on every palette-created role, so this
 * costs zero client-side changes to start benefiting from — see
 * buildRolePrompt in session.ts for where it's actually injected.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cache = new Map<string, string | null>();

function roleSkillsDir(): string {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // This module ships at <package-root>/dist/src/orgrt/role-skills.js;
  // the markdown directory is copied alongside it at build time into
  // dist/src/orgrt/role-skills/ (see package.json's build/build:loose
  // scripts) — a plain sibling of this compiled file either way, run from
  // source (src/orgrt/role-skills/) or installed (dist/src/orgrt/role-skills/).
  return join(__dirname, 'role-skills');
}

/**
 * Returns the bundled best-practices markdown for iconId, or null if
 * iconId is unset or doesn't match a known archetype (a custom/unknown
 * icon is not an error — most orgs will have roles with no bundled
 * content, that's expected). Cached in memory: the same archetype is
 * looked up on every session start for a long-running org.
 */
export function loadBuiltinRoleSkill(iconId: string | undefined | null): string | null {
  if (!iconId) return null;
  if (cache.has(iconId)) return cache.get(iconId) as string | null;

  const path = join(roleSkillsDir(), `${iconId}.md`);
  let content: string | null = null;
  if (existsSync(path)) {
    try {
      content = readFileSync(path, 'utf-8').trim();
    } catch {
      content = null; // unreadable — treat like "no bundled content" rather than crashing session start
    }
  }
  cache.set(iconId, content);
  return content;
}
