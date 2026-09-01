/**
 * The real `mastermind:createorg` skill content, for injection into
 * headless `agent exec` sessions that expose the org-design tools
 * (create_org/add_org_role/etc. — see agent-exec.ts). Those sessions run
 * through ClaudeAgentRunner with `settingSources: []` and no `skills`
 * option set (agent-runner.ts), so there is categorically no
 * Claude-Code-native path by which the model would ever see
 * `.claude/skills/mastermind-createorg/SKILL.md` on its own — this reads
 * the actual file and hands its content to the caller to fold into
 * `systemPrompt`, rather than hand-paraphrasing the skill into a second,
 * driftable copy of the same guidance.
 *
 * Mirrors role-skills.ts's resolution/caching pattern exactly, one level
 * up: that file bundles per-role best-practices docs alongside itself;
 * this one reads a skill file that already ships at the package root
 * (`.claude` is in package.json's `files` array), so no separate copy
 * step is needed in package.json's build scripts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

let cached: string | null | undefined; // undefined = not yet loaded, null = load attempted and failed/missing

function createOrgSkillCandidates(): string[] {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const tail = ['.claude', 'skills', 'mastermind-createorg', 'SKILL.md'];
  return [
    // Installed/built: this module ships at
    // <package-root>/dist/src/orgrt/org-design-skill.js — 3 levels up to
    // package root, matching tokens.ts's getTrackerPath depth (dist/src/orgrt
    // and dist/src/commands are sibling nesting levels).
    join(__dirname, '..', '..', '..', ...tail),
    // Run from TS source directly (vitest, ts-node): this module is at
    // <package-root>/src/orgrt/org-design-skill.ts — only 2 levels up.
    join(__dirname, '..', '..', ...tail),
  ];
}

/**
 * Returns the createorg skill's full markdown content, or null if the file
 * isn't present under any known layout (e.g. a stripped install that
 * dropped `.claude/`) — never throws. Cached in memory after the first
 * successful/failed read, since this is looked up once per chat session,
 * not per turn.
 */
export function loadCreateOrgSkillGuidance(): string | null {
  if (cached !== undefined) return cached;
  cached = null;
  for (const path of createOrgSkillCandidates()) {
    try {
      if (existsSync(path)) {
        cached = readFileSync(path, 'utf-8').trim();
        break;
      }
    } catch {
      // unreadable — try the next candidate rather than crashing session start
    }
  }
  return cached;
}
