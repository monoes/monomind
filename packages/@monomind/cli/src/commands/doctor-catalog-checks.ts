/**
 * Doctor — skill catalog check (`doctor -c catalog`). Re-hashes every entry
 * through `catalogAudit` and dry-plans both projection surfaces; never writes.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PROJECTION_SURFACES, planProjection } from '../catalog/projection.js';
import { catalogAudit } from '../catalog/snapshot.js';
import { nonBundledSkillLines } from '../orgrt/org-sign-review.js';
import {
  quarantine,
  quarantineMessage,
  strayClaudeConfigs,
  untrackedWorktreeMcp,
} from '../orgrt/planted-paths.js';
import type { HealthCheck } from './doctor-env-checks.js';

/** `doctor -c org-skills` (#502 review): org skills from the project or user
 *  library, which decide MCP tools the org daemon grants. Informational. */
export async function checkOrgSkills(
  root: string = process.cwd(),
  readOnly = false,
): Promise<HealthCheck[]> {
  const lines = nonBundledSkillLines(root).map((l) => l.trim());
  return [
    checkStrayClaudeConfig(root, readOnly),
    {
      name: 'Org Skills',
      status: 'pass',
      message: lines.length
        ? `${lines.length} from the project or user library (not bundled): ${lines.join('; ')}`
        : 'Only bundled org skills',
    },
    checkMcpjsonApprovals(root),
  ];
}

/** #502 review round 4: a Claude Code global config other than the current
 *  one (above all `~/.claude/.config.json`, which Claude Code prefers when it
 *  exists) or an untracked `.mcp.json` in an org work tree is quarantined on
 *  every doctor run — reported only under --read-only. */
export function checkStrayClaudeConfig(root: string, readOnly: boolean): HealthCheck {
  const NAME = 'Planted Claude Config';
  const found = [
    ...strayClaudeConfigs(homedir(), process.env, undefined, { readOnly }),
    ...untrackedWorktreeMcp(root),
  ];
  if (!found.length) return { name: NAME, status: 'pass', message: 'None' };
  if (readOnly)
    return {
      name: NAME,
      status: 'warn',
      message: `Found ${found.join(', ')}: Claude Code would load it (a role may have planted it)`,
      fix: 'Run monomind doctor without --read-only to quarantine it',
    };
  const findings = quarantine(found, root);
  return {
    name: NAME,
    status: 'warn',
    message: quarantineMessage(undefined, findings).replace(/\n/g, ' '),
  };
}

/** #502 review round 3: settings that approve `.mcp.json` servers by name
 *  (`enabledMcpjsonServers`, `enableAllProjectMcpServers`) start whatever a
 *  `.mcp.json` of that name says, unprompted. That is only as safe as the
 *  `.mcp.json` itself: warn when it is missing, untracked or modified —
 *  anything that can write the project (an org role) could drop one in. */
export function checkMcpjsonApprovals(root: string): HealthCheck {
  const NAME = 'Project MCP Approvals';
  const approved: string[] = [];
  for (const f of ['settings.json', 'settings.local.json']) {
    try {
      const s = JSON.parse(readFileSync(join(root, '.claude', f), 'utf8')) as {
        enabledMcpjsonServers?: unknown;
        enableAllProjectMcpServers?: unknown;
      };
      if (Array.isArray(s.enabledMcpjsonServers))
        approved.push(...s.enabledMcpjsonServers.map(String));
      if (s.enableAllProjectMcpServers === true) approved.push('(all)');
    } catch {
      /* no such settings file */
    }
  }
  if (!approved.length)
    return { name: NAME, status: 'pass', message: 'No .mcp.json servers approved by name' };
  const git = (args: string[]) =>
    spawnSync('git', ['-C', root, ...args], {
      stdio: 'ignore',
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, // #681
    }).status;
  const state = !existsSync(join(root, '.mcp.json'))
    ? 'missing'
    : git(['ls-files', '--error-unmatch', '.mcp.json']) !== 0
      ? 'untracked'
      : git(['diff', '--quiet', 'HEAD', '--', '.mcp.json']) !== 0
        ? 'modified from what git has'
        : undefined;
  if (!state)
    return {
      name: NAME,
      status: 'pass',
      message: `Approves ${approved.join(', ')}; .mcp.json is tracked and unchanged`,
    };
  return {
    name: NAME,
    status: 'warn',
    message: `.claude settings approve .mcp.json server(s) ${approved.join(', ')} by name, but .mcp.json is ${state}: a .mcp.json that anything able to write this project drops in (an org role, for one) starts unprompted in your next Claude Code session here`,
    fix: 'Keep .mcp.json tracked and unchanged (review `git diff .mcp.json`), or remove the approval from .claude/settings*.json',
  };
}

const NAME = 'Skill Catalog';

export async function checkCatalog(
  root: string = process.cwd(),
  now: number = Date.now(),
): Promise<HealthCheck> {
  const audit = catalogAudit(root, now);
  if (!audit.configured)
    return {
      name: NAME,
      status: 'pass',
      message: 'Not configured (no .monomind/catalog/state.json)',
    };
  if (audit.error)
    return {
      name: NAME,
      status: 'fail',
      message: `Invalid .monomind/catalog/state.json: ${audit.error}`,
      fix: 'Repair .monomind/catalog/state.json by hand; catalog consumers ignore it until it parses',
    };

  const failures = audit.entries.filter((e) => e.status === 'active' && e.problems.length);
  if (failures.length)
    return {
      name: NAME,
      status: 'fail',
      message: failures.map((e) => `${e.id}: ${e.problems.join(', ')}`).join('; '),
      fix: failures.map((e) => `monomind catalog disable ${e.id} --actor <you>`).join('; '),
    };

  const warnings: string[] = [];
  const fixes: string[] = [];
  const activeIds = new Set(audit.entries.filter((e) => e.status === 'active').map((e) => e.id));
  for (const c of audit.legacyCollisions) {
    if (!activeIds.has(c.catalogId) || c.replacesLegacy) continue;
    warnings.push(
      `${c.catalogId} collides with ${c.legacyOrigin} legacy skill "${c.name}" (legacy wins)`,
    );
    fixes.push(
      `monomind catalog disable ${c.catalogId} --actor <you>, or stage a new revision and approve it with --replaces-legacy`,
    );
  }
  for (const s of audit.stale) {
    if (s.status !== 'staged' && s.status !== 'quarantined') continue;
    warnings.push(`${s.id} has been ${s.status} for ${s.ageDays} days`);
    fixes.push(`monomind catalog inspect ${s.id}, then approve or revoke it`);
  }
  for (const surface of PROJECTION_SURFACES) {
    const plan = await planProjection(root, surface);
    const drift = plan.diagnostics.filter((d) => d.includes('frontmatter-drift'));
    for (const r of plan.removals)
      warnings.push(`${r.id} is still projected to ${surface} but no longer eligible`);
    for (const d of drift) warnings.push(`${surface}: ${d}`);
    if (plan.removals.length || drift.length)
      fixes.push(`monomind catalog project --surface ${surface} --apply`);
  }

  const targets = Object.entries(audit.activeByTarget)
    .map(([t, n]) => `${t} ${n}`)
    .join(', ');
  const summary = `${audit.active} active, ${audit.entries.length} total${targets ? ` (${targets})` : ''}`;
  if (warnings.length)
    return {
      name: NAME,
      status: 'warn',
      message: `${summary}; ${warnings.join('; ')}`,
      fix: fixes.join('; '),
    };
  return { name: NAME, status: 'pass', message: summary };
}
