// packages/@monomind/cli/src/commands/org-observe-shared.ts
//
// Helpers shared by the org observe subcommand modules: protocol JSON output,
// the --by resolver flag, endpoint-role ids and --run resolution.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { sectionBudgetReportRows } from '../orgrt/documents/section-budget-report.js';
import { listRunDirs, readRunEvents, summarizeRun } from '../orgrt/reporting.js';
import { ORG_DIR, OrgDefSchema } from '../orgrt/types.js';
import type { CommandContext, CommandResult } from '../types.js';

// ─── Agent Exec Protocol JSON output (doc/agent-exec-protocol.md §7) ────────
// Org observe commands emit machine JSON under the global `--format json`
// flag: one JSON object on stdout, diagnostics on stderr only. Envelope for
// lists {v, org, items}; singletons are bare objects carrying v.

/** The broker entry of the daemon hosting THIS project's org `name`, or null
 *  (same rule as the dashboard's hostingDaemon): a same-named org hosted from
 *  another project root must not receive this project's decisions. An entry
 *  that predates the root field is taken as this project's.
 *
 *  A human decision (answer, dismissal, approval, gate) goes to that daemon
 *  when there is one. If it REFUSES — 403 without the operator credential,
 *  unknown id, already resolved — the command must fail with nothing
 *  recorded: writing the state file behind its back would resolve the
 *  decision without the operator check, the audit event or delivery. Only an
 *  unreachable daemon falls back to the offline file write. */
export const hostingDaemonFor = async (
  cwd: string,
  name: string,
): Promise<{ url: string } | null> => {
  const { lookupOrg, normalizeRoot } = await import('../orgrt/broker.js');
  const found = lookupOrg(name);
  return found && (!found.root || found.root === normalizeRoot(cwd)) ? found : null;
};

/** True when this invocation asked for protocol JSON output. */
export const orgJson = (ctx: CommandContext): boolean => ctx.flags.format === 'json';

/** Print one protocol JSON payload on stdout (compact — one line, NDJSON-safe
 *  for line-oriented callers) and return a success result. */
export const printOrgJson = (payload: Record<string, unknown>): CommandResult => {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
  return { success: true, data: payload };
};

/** M5: `--by <resolver>` — who resolved a decision (default `human`). Returns
 *  an error string for an invalid value. */
export const resolverFlag = async (
  ctx: CommandContext,
): Promise<{ ok: true; by: string } | { ok: false; message: string }> => {
  const raw = ctx.flags.by;
  if (raw === undefined || raw === false) return { ok: true, by: 'human' };
  const { normalizeResolver } = await import('../orgrt/approvals.js');
  const by = normalizeResolver(raw);
  if (!by) return { ok: false, message: '--by must be 1-128 printable characters' };
  return { ok: true, by };
};

/** M2: ids of the org's endpoint roles (automations, not agents) — excluded
 *  from the costs/report/flow role tables. Unreadable config → none. */
export const endpointRoleIds = (cwd: string, name: string): Set<string> => {
  try {
    const raw = JSON.parse(readFileSync(join(cwd, ORG_DIR, `${name}.json`), 'utf8')) as {
      roles?: Array<{ id?: unknown; kind?: unknown }>;
    };
    return new Set(
      (Array.isArray(raw.roles) ? raw.roles : [])
        .filter((r) => r?.kind === 'endpoint' && typeof r.id === 'string')
        .map((r) => r.id as string),
    );
  } catch {
    return new Set();
  }
};

/** The JSON `sections` field of a run: the rows of the `org report` section table, computed by the same function
 *  from the run's usage events. Omitted (an empty object to spread) when the org has no section budgets, the run
 *  has no events or the definition is unreadable, so such orgs' JSON is unchanged. */
export const sectionsJson = (
  cwd: string,
  name: string,
  run: string | undefined,
): { sections?: ReturnType<typeof sectionBudgetReportRows> } => {
  if (!run) return {};
  try {
    const def = OrgDefSchema.parse(
      JSON.parse(readFileSync(join(cwd, ORG_DIR, `${name}.json`), 'utf8')),
    );
    const events = readRunEvents(cwd, name, run);
    if (!events.length) return {};
    const roles = summarizeRun(events).roles;
    for (const id of endpointRoleIds(cwd, name)) delete roles[id];
    const sections = sectionBudgetReportRows(def as never, roles);
    return sections.length ? { sections } : {};
  } catch {
    return {};
  }
};

// Run ids are joined into filesystem paths — enforce the daemon's own id shape
// so a crafted --run can't traverse out of the org directory (same reason the
// org-name guard exists).
const RUN_ID_RE = /^run-[A-Za-z0-9-]+$/;
export const resolveRun = (cwd: string, name: string, runFlag: unknown): string | null => {
  if (typeof runFlag === 'string' && runFlag) return RUN_ID_RE.test(runFlag) ? runFlag : null;
  return listRunDirs(cwd, name)[0] ?? null;
};
