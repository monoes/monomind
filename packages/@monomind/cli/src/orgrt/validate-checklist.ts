// packages/@monomind/cli/src/orgrt/validate-checklist.ts
/**
 * Org sections spec, section 7.3: the caveat checklist, as findings shared by
 * every path that saves or starts an org (`org validate`, `org run`/`serve`
 * start, reload, create, role edits, the dashboard).
 *
 * Mandatory constraints are errors; efficiency advice is a warning. Only the
 * checks whose capability exists today live here: the section-only items
 * (11-13, 15-18) activate when sections ship, and a deferred feature that is
 * configured fails with "not yet supported" rather than being ignored.
 * Each message names its checklist item (`#N`) and a remedy.
 */
import { effectiveRoleRuntime } from './runner-specs.js';
import { type OrgDef, OrgDefSchema } from './types.js';

type OrgRole = OrgDef['roles'][number];

export interface ChecklistFindings {
  errors: string[];
  warnings: string[];
}

/** Top-level features that are designed but not built. The runtime would
 *  ignore them silently, so configuring one is an error. */
const DEFERRED_TOP_LEVEL = ['sections', 'documents', 'loops', 'requires'];
const DEFERRED_RUN_CONFIG = ['budget_usd', 'budget_mode', 'experimental'];
/** Keys other components read through `.passthrough()` without a schema entry:
 *  mono-agent's display copies, and `max_run`, which `org serve` reads. */
const PASSTHROUGH_TOP_LEVEL = ['automations', 'autonomy'];
const PASSTHROUGH_RUN_CONFIG = ['max_run'];

/** Runtimes whose runners report tokens but no USD cost (spec A27, verified
 *  for these two), so `budget_usd` cannot close a role on them. */
const UNPRICED_RUNTIMES = ['codex', 'antigravity'];

/** Tools that wait for an approval unless a role pre-approves or denies them
 *  (approvals.ts SENSITIVE_ACTIONS, minus org_complete). */
const GATED_TOOLS = ['Bash', 'WebFetch', 'WebSearch'];

/** The keys of the schema node behind a (possibly piped or wrapped) object. */
function schemaKeys(node: unknown, depth = 0): string[] | undefined {
  const n = node as { shape?: Record<string, unknown>; def?: Record<string, unknown> } | undefined;
  if (!n || depth > 8) return undefined;
  if (n.shape) return Object.keys(n.shape);
  for (const k of ['in', 'out', 'innerType', 'schema']) {
    const found = schemaKeys(n.def?.[k], depth + 1);
    if (found) return found;
  }
  return undefined;
}

const shape = (OrgDefSchema as unknown as { shape: Record<string, unknown> }).shape;
const KNOWN_TOP_LEVEL = new Set(Object.keys(shape));
const KNOWN_RUN_CONFIG = new Set(schemaKeys(shape.run_config) ?? []);

const isAgent = (r: OrgRole): boolean => r.kind !== 'endpoint';
const prompt = (r: OrgRole): string => [r.title, ...(r.responsibilities ?? [])].join('\n');
const runtimeOf = (def: OrgDef, r: OrgRole): string =>
  effectiveRoleRuntime(r.runtime, (def as { runtime?: unknown }).runtime, r.provider?.kind);

/** True when `path` lies under one of the scope entries (a bare `*`/`**` covers all). */
function covered(path: string, scopes: string[]): boolean {
  return scopes.some((s) => {
    if (s === '*' || s === '**') return true;
    const base = s.split('*')[0].replace(/\/+$/, '');
    return base !== '' && (path === base || path.startsWith(`${base}/`));
  });
}

/** Absolute filesystem paths in prose. Only paths under a real root count; a
 *  duty that says `/popular/referrers` is naming an API route. */
const ABS_PATH =
  /(?:^|[\s`"'(])(\/(?:home|Users|var|tmp|srv|opt|etc|mnt|usr|root|data)(?:\/[\w.-]+)+)/g;
const WRITE_VERB = /\b(write|writes|create|creates|save|saves|append|appends|update|updates)\b/i;
const SHELL_WORK = /`\s*(gh|npm|npx|pnpm|git|curl|node|python3?|make|docker)\s[^`]*`|\bshell\b/i;
const ISO_DATE = /\b20\d{2}-\d{2}-\d{2}\b/;

export function checklistFindings(def: OrgDef): ChecklistFindings {
  const errors: string[] = [];
  const warnings: string[] = [];
  const raw = def as unknown as Record<string, unknown>;
  const rc = (def.run_config ?? {}) as Record<string, unknown>;
  const agents = def.roles.filter(isAgent);

  // Deferred features: never silently ignored.
  for (const k of DEFERRED_TOP_LEVEL)
    if (k in raw)
      errors.push(`"${k}" is not yet supported (org sections are designed, not built) — remove it`);
  for (const k of DEFERRED_RUN_CONFIG)
    if (k in rc) errors.push(`run_config.${k} is not yet supported — remove it`);
  // Unknown keys are ignored by the runtime: a typo changes nothing, quietly.
  for (const k of Object.keys(raw))
    if (
      !KNOWN_TOP_LEVEL.has(k) &&
      !DEFERRED_TOP_LEVEL.includes(k) &&
      !PASSTHROUGH_TOP_LEVEL.includes(k)
    )
      warnings.push(`unknown top-level key "${k}" is ignored by the runtime — check the spelling`);
  for (const k of Object.keys(rc))
    if (
      !KNOWN_RUN_CONFIG.has(k) &&
      !DEFERRED_RUN_CONFIG.includes(k) &&
      !PASSTHROUGH_RUN_CONFIG.includes(k)
    )
      warnings.push(`unknown run_config.${k} is ignored by the runtime — check the spelling`);

  for (const r of agents) {
    const text = prompt(r);
    const pol = r.policy;
    // #1 file scopes must cover the files a role's duties name.
    for (const duty of r.responsibilities ?? []) {
      const paths = [...duty.matchAll(ABS_PATH)].map((m) => m[1]);
      if (pol?.fileRead && pol.fileRead.length)
        for (const p of paths)
          if (!covered(p, pol.fileRead))
            warnings.push(
              `#1 role "${r.id}": its duties name ${p}, outside its fileRead scope — add it, or the role cannot read it`,
            );
      if (pol?.fileWrite && pol.fileWrite.length && WRITE_VERB.test(duty))
        for (const p of paths)
          if (!covered(p, pol.fileWrite))
            warnings.push(
              `#1 role "${r.id}": its duties write ${p}, outside its fileWrite scope — add it, or the write is refused`,
            );
    }
    // #2 shell duties need Bash.
    const bashDenied =
      pol?.denyTools?.includes('Bash') || (pol?.allowTools && !pol.allowTools.includes('Bash'));
    if (bashDenied && SHELL_WORK.test(text))
      warnings.push(
        `#2 role "${r.id}": its duties name shell work but Bash is denied — allow Bash, or give it a workflow or tool that does the job`,
      );
    // #7 SendMessage is always denied.
    if (/\bSendMessage\b/.test(text))
      warnings.push(
        `#7 role "${r.id}": its text tells it to use SendMessage, which is always denied — org messaging is org_send`,
      );
    // #9 per-task detail belongs in the brief, not the stable prompt.
    if (ISO_DATE.test(text))
      warnings.push(
        `#9 role "${r.id}": its prompt carries a dated detail; changing the prompt starts a new cache prefix — put per-task detail in the task brief`,
      );
    // #10 explicit model.
    if (runtimeOf(def, r) === 'claude' && !r.adapter_config?.model)
      warnings.push(
        `#10 role "${r.id}": no explicit model — it runs on whatever the default is; pin one`,
      );
  }

  // #3 capacity: an idle worker keeps its slot, so the cap must cover the roster.
  const cap = rc.max_concurrent_agents as number | undefined;
  if (cap !== undefined && agents.length > cap)
    warnings.push(
      `#3 run_config.max_concurrent_agents is ${cap} but the org has ${agents.length} roles; roles past the cap wait for a slot (a finished worker keeps its slot) — raise it to ${agents.length}`,
    );

  // #4 budgets.
  const unpriced = agents.filter((r) => UNPRICED_RUNTIMES.includes(runtimeOf(def, r)));
  const priced = agents.filter((r) => !unpriced.includes(r));
  for (const r of unpriced)
    if (r.budget_usd !== undefined)
      warnings.push(
        `#4 role "${r.id}": budget_usd never closes a ${runtimeOf(def, r)} role (it reports no USD); its token cap is its only enforced limit`,
      );
  if (
    priced.length > 0 &&
    !priced.some((r) => r.budget_usd !== undefined || r.policy?.maxUsd !== undefined)
  )
    warnings.push(
      '#4 no role has a USD ceiling (budget_usd); budget_tokens defaults to 1M on the uncached basis, which under-reports real spend — prefer budget_usd on priced roles',
    );

  // #5 and #14 approvals that nobody answers.
  const decider = (raw.autonomy as { level?: string } | undefined)?.level;
  const humanOnly = decider === undefined || decider === 'manual';
  if (humanOnly) {
    const waiting = agents
      .filter((r) => runtimeOf(def, r) === 'claude')
      .flatMap((r) => {
        const denied = new Set(r.policy?.denyTools ?? []);
        const auto = new Set(r.policy?.autoApproveTools ?? []);
        const allow = r.policy?.allowTools;
        const tools = GATED_TOOLS.filter(
          (t) => !denied.has(t) && !auto.has(t) && (!allow || allow.includes(t)),
        );
        return tools.length ? [`${r.id} (${tools.join(', ')})`] : [];
      });
    if (waiting.length) {
      warnings.push(
        `#5 these roles wait for a human approval on each distinct command and nothing resolves them unattended: ${waiting.join('; ')} — list safe classes in autoApproveTools, deny the tool, or set an autonomy decider`,
      );
      if (def.schedule !== null && def.schedule !== undefined)
        warnings.push(
          '#14 this org is scheduled, but those approvals can wait on a human who is not there; a cycle can sit until it is stopped — set an autonomy decider or autoApproveTools',
        );
    }
  }

  // #8 the boss must require self-contained briefs.
  const boss =
    def.roles.find((r) => r.type === 'boss') ?? def.roles.find((r) => r.reports_to == null);
  if (boss && isAgent(boss) && !/self-contained|brief/i.test(prompt(boss)))
    warnings.push(
      `#8 boss role "${boss.id}": its prompt does not require self-contained task briefs; workers resumed from a task session know nothing else`,
    );

  return { errors, warnings };
}

/** The checklist's errors for an unparsed definition (a dashboard import or
 *  create body). A body that does not parse is left to the schema's own
 *  error, so this returns nothing for it. */
export function checklistErrorsForRaw(raw: unknown): string[] {
  const parsed = OrgDefSchema.safeParse(raw);
  return parsed.success ? checklistFindings(parsed.data).errors : [];
}
