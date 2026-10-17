// packages/@monomind/cli/src/orgrt/validate-run-defects.ts
/**
 * Checklist items #22-#24: defects that cost a real run before anything said so
 * (reputation-panel, 2026-10-17). Warnings, shared by every path that saves or
 * starts an org through checklistFindings.
 */
import { effectiveRoleRuntime } from './runner-specs.js';
import type { OrgDef } from './types.js';

type Role = OrgDef['roles'][number];

/** Default `run_config.budget_tokens` when an org sets none (see #4). */
const DEFAULT_BUDGET_TOKENS = 1_000_000;
/** Below this per-role share, a role that browses or re-reads files can hit its cap mid-task. */
const MIN_BROWSING_SHARE = 750_000;

const bashDenied = (r: Role): boolean =>
  !!r.policy?.denyTools?.includes('Bash') ||
  (!!r.policy?.allowTools && !r.policy.allowTools.includes('Bash'));

export function runDefectWarnings(def: OrgDef, agents: Role[]): string[] {
  const out: string[] = [];
  const rc = (def.run_config ?? {}) as Record<string, unknown>;

  // #22 completion_evidence pins a task's completion to a commit sha, which a role with no Bash
  // cannot produce: its org_task_done is refused and the lead has to cancel the task by hand.
  if (rc.completion_evidence === true) {
    const cannot = agents.filter(bashDenied).map((r) => r.id);
    if (cannot.length)
      out.push(
        `#22 run_config.completion_evidence is on, but ${cannot.join(', ')} deny Bash and cannot produce the commit evidence it requires — their org_task_done is refused; turn completion_evidence off for an org that does not commit, or allow Bash`,
      );
  }

  // #23 budget_tokens is split evenly across roles, whatever each role does.
  const budget = typeof rc.budget_tokens === 'number' ? rc.budget_tokens : DEFAULT_BUDGET_TOKENS;
  const share = Math.floor(budget / Math.max(1, def.roles.length));
  if (share < MIN_BROWSING_SHARE && agents.some((r) => r.policy?.webAllow?.length))
    out.push(
      `#23 run_config.budget_tokens is ${budget.toLocaleString('en-US')} across ${def.roles.length} roles, so each gets about ${share.toLocaleString('en-US')} tokens; roles that browse or re-read large files hit that cap and stop mid-task — raise it to about ${(def.roles.length * 1_000_000).toLocaleString('en-US')}`,
    );

  // #24 two runtimes cannot enforce a role's file scopes: antigravity has no OS sandbox at all, and
  // codex's own sandbox confines writes to the working directory but does not restrict reads, so a
  // codex scorer read the other scorers' files that its fileRead did not list.
  for (const r of agents) {
    const runtime = effectiveRoleRuntime(r.runtime, def.runtime, r.provider?.kind);
    if (runtime === 'antigravity' && (r.policy?.fileRead?.length || r.policy?.fileWrite?.length))
      out.push(
        `#24 role "${r.id}" runs on antigravity, which has no OS sandbox: its fileRead/fileWrite scopes are a request to the model, not enforced — it can read or write outside them`,
      );
    if (runtime === 'codex' && (r.policy?.fileRead?.length || r.policy?.fileWrite?.length))
      out.push(
        `#24 role "${r.id}" runs on codex, whose own sandbox confines writes to the working directory but does not restrict reads: its fileRead scope is not enforced (it can read files it does not list), and its fileWrite only as far as the working directory — do not rely on either to keep it blind or out of a folder`,
      );
  }

  return out;
}
