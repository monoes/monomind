/**
 * Doctor — settings that multiply token use (#655). Read-only: it names the
 * file and key, never edits a user's settings. Monomind writes none of these
 * but AGENT_TEAMS, so there is no Monomind-owned entry to migrate.
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { hookKey } from '../init/hook-identity.js';
import type { HealthCheck } from './doctor-env-checks.js';

const NAME = 'Token Cost Settings';

interface Scope {
  label: string;
  env: Record<string, string>;
  effortLevel?: string;
  hooks: Map<string, { matcher?: string; command: string }[]>;
}

function readScope(label: string, file: string): Scope | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'));
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(d?.env ?? {})) env[k] = String(v);
    const hooks = new Map<string, { matcher?: string; command: string }[]>();
    for (const [ev, groups] of Object.entries(d?.hooks ?? {})) {
      const cmds: { matcher?: string; command: string }[] = [];
      for (const g of Array.isArray(groups) ? groups : [])
        for (const h of Array.isArray(g?.hooks) ? g.hooks : [])
          if (typeof h?.command === 'string')
            cmds.push({
              ...(typeof g.matcher === 'string' ? { matcher: g.matcher } : {}),
              command: h.command,
            });
      hooks.set(ev, cmds);
    }
    return {
      label,
      env,
      hooks,
      ...(typeof d?.effortLevel === 'string' ? { effortLevel: d.effortLevel } : {}),
    };
  } catch {
    return undefined;
  }
}

export async function checkTokenCostSettings(cwd: string): Promise<HealthCheck> {
  const scopes = [
    readScope('~/.claude/settings.json', join(homedir(), '.claude', 'settings.json')),
    readScope('.claude/settings.json', join(cwd, '.claude', 'settings.json')),
    readScope('.claude/settings.local.json', join(cwd, '.claude', 'settings.local.json')),
  ].filter((s): s is Scope => !!s);
  const processScope: Scope = {
    label: 'process env',
    env: Object.fromEntries(
      Object.entries(process.env).filter((e): e is [string, string] => typeof e[1] === 'string'),
    ),
    hooks: new Map(),
  };

  const issues: string[] = [];
  const notes: string[] = [];
  for (const s of [...scopes, processScope]) {
    const e = s.env;
    const effort = e.CLAUDE_CODE_EFFORT_LEVEL;
    if (effort) {
      const local = scopes.find((x) => x.effortLevel && x.effortLevel !== effort)?.effortLevel;
      issues.push(
        `${s.label}: CLAUDE_CODE_EFFORT_LEVEL=${effort} outranks every /effort or effortLevel choice` +
          (local ? ` (effortLevel=${local} is ignored)` : ''),
      );
    }
    const compact = Number(e.CLAUDE_CODE_AUTO_COMPACT_WINDOW);
    if (compact > 400_000)
      issues.push(
        `${s.label}: CLAUDE_CODE_AUTO_COMPACT_WINDOW=${compact} lets context grow to ~${Math.round(compact / 1000)}K before compaction (150–200K is typical)`,
      );
    const out = Number(e.CLAUDE_CODE_MAX_OUTPUT_TOKENS);
    if (out > 64_000) issues.push(`${s.label}: CLAUDE_CODE_MAX_OUTPUT_TOKENS=${out}`);
    if (e.ENABLE_TOOL_SEARCH === 'false')
      issues.push(
        `${s.label}: ENABLE_TOOL_SEARCH=false loads every MCP tool schema into each request`,
      );
    if (e.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS === '1' && s.label !== 'process env')
      notes.push(`${s.label}: AGENT_TEAMS=1 (teammate messages wake the parent context)`);
  }

  // Same helper+argument twice, in one file (an old and a new command form)
  // or in two: each registration runs.
  const seen = new Map<string, string>();
  const dupes = new Set<string>();
  for (const s of scopes)
    for (const [ev, cmds] of s.hooks)
      for (const c of cmds) {
        const k = hookKey(ev, c.matcher, c.command);
        const prev = seen.get(k);
        const where = prev === s.label ? `twice in ${s.label}` : `in ${prev} and ${s.label}`;
        if (prev) dupes.add(`${ev} hook ${k.split('\0')[2]} registered ${where}`);
        else seen.set(k, s.label);
      }
  issues.push(...[...dupes].slice(0, 5));

  if (issues.length === 0)
    return {
      name: NAME,
      status: 'pass',
      message: notes.length
        ? `No cost-multiplying settings (${notes[0]})`
        : 'No cost-multiplying settings',
    };
  return {
    name: NAME,
    status: 'warn',
    message: issues.join('; '),
    fix: 'Remove the named keys from that file (back it up first); doctor does not edit settings it does not own',
    fixSafety: 'manual',
  };
}
