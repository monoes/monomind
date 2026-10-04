// packages/@monomind/cli/src/orgrt/session-prompt.ts
// Extracted from session.ts — a role session's system prompt and model.
import { documentGuidance } from './documents/guidance.js';
import { endpointBriefingLines } from './endpoint-roles.js';
import { readVerifiedInstructions } from './instructions-file.js';
import { expandRolePromptVars, promptVarsFor } from './prompt-vars.js';
import type { SessionOpts } from './session-types.js';
import { roleSkillGuidance } from './skill-library.js';
import type { OrgDef, OrgRole } from './types.js';
import { DEFAULT_CLAUDE_MODEL, VERCEL_PROVIDERS } from './vercel-providers.js';

/**
 * Resolves the extra system-prompt block for a role: its pinned library
 * skills and on-demand skill catalog (skill-library.ts) plus the role's own
 * `instructions_file`, if any — all optional and independent. A missing or
 * unreadable `instructions_file` is skipped (not an error): a role shouldn't
 * fail to start a session over a stale/typo'd custom-file path.
 */
export function resolveRoleExtraGuidance(role: OrgRole, projectRoot?: string): string | undefined {
  const parts: string[] = [];
  const skills = roleSkillGuidance(role, projectRoot);
  if (skills) parts.push(skills);
  if (role.instructions_file) {
    // #502 review: only a file inside the project, nothing a role may not
    // read, and only while its content still matches the verified digest.
    const file = readVerifiedInstructions(
      role.instructions_file,
      projectRoot ?? process.cwd(),
      (role as { instructions_sha256?: string }).instructions_sha256,
    );
    if (file.text === undefined)
      console.warn(`[orgrt] role ${role.id}: ${file.refused} — not read`);
    else if (file.text.trim()) parts.push(file.text.trim());
  }
  return parts.length ? parts.join('\n\n') : undefined;
}

/** Resolve the model string for a role: explicit adapter_config.model wins;
 *  otherwise fall back to the vendor/runtime default.
 *
 *  Vendor defaults are read straight off VERCEL_PROVIDERS, which already
 *  carries a defaultModel per vendor. A second hand-kept table lived here and
 *  restated all sixteen of them — two lists of per-vendor defaults that would
 *  eventually disagree, which is precisely the drift #252 was. An empty
 *  registry default (openai-compatible, which serves arbitrary endpoints) is
 *  falsy and so falls through to the runtime switch, as it always did. */
export function resolveModel(role: OrgRole, runtime?: string, vendor?: string): string {
  const explicit = role.adapter_config?.model;
  if (explicit) return explicit;
  const vendorDefault = vendor ? VERCEL_PROVIDERS[vendor]?.defaultModel : undefined;
  if (vendorDefault) return vendorDefault;
  switch (runtime) {
    case 'claude':
      return DEFAULT_CLAUDE_MODEL;
    // Kimi Code CLI namespaces model ids as <provider>/<model> (its own
    // default_model is "kimi-code/kimi-for-coding-highspeed") — a bare "k3"
    // 404s with "Model \"k3\" is not configured in config.toml".
    case 'kimicode':
      return 'kimi-code/k3';
    case 'opencode':
      return 'glm-5.2'; // opencode is typically paired with a vendor; this is the bare-runtime fallback
    case 'codex':
      return 'gpt-5.6-terra';
    case 'antigravity':
      return 'gemini-3.6-flash-high';
    case 'vercel':
      return 'gpt-5.5';
    default:
      return DEFAULT_CLAUDE_MODEL;
  }
}

/** Role briefing given to each agent session (SDK systemPrompt option).
 *  `extraGuidance` carries pre-resolved text the caller already loaded from
 *  disk — the role's library skills and/or its own `instructions_file`,
 *  if either resolved to something. Kept as a plain string param (not read here)
 *  so this function stays synchronous/pure and trivially testable. */
export function buildRolePrompt(
  role: OrgRole,
  def: Pick<OrgDef, 'name' | 'goal'>,
  roster: string[],
  glossary?: string[],
  extraGuidance?: string,
  /** M2: one line per endpoint role (endpointBriefingLines) — boss only. */
  endpointBriefing?: string[],
): string {
  const isCoordinator = role.reports_to == null;
  return [
    `You are agent "${role.id}" (${role.title || role.type}) in the org "${def.name}".`,
    `Org goal: ${def.goal}`,
    isCoordinator ? `You are the coordinator of this org.` : `You report to "${role.reports_to}".`,
    role.responsibilities?.length
      ? `Your responsibilities:\n- ${role.responsibilities.join('\n- ')}`
      : '',
    extraGuidance || '',
    `## Communication protocol`,
    `The ONLY way to communicate with other agents is the org_send tool.`,
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    endpointBriefing?.length ? `Automations in this org:\n${endpointBriefing.join('\n')}` : '',
    `If you need a human decision, call ask_human with your question, then end your turn - you'll receive the human's answer as a new message when it arrives. Do not call ask_human for anything you can resolve yourself.`,
    `For irreversible or high-risk actions (deployments, deletions, external communications), call org_gate to create a decision gate — a hard-blocking approval checkpoint. End your turn and wait for the human's approval or rejection before proceeding.`,
    `You can structure work as a task DAG: use org_task to create tasks with dependencies, org_task_done to mark them complete, and org_tasks to see the full DAG. Tasks with satisfied dependencies are automatically dispatched to their assignee.`,
    `The work graph is dynamic: call org_task_split when scope expands, org_task_merge when parallel branches converge early, or org_task_cancel when evidence makes a planned task moot. Use org_plan_graph to propose a full work graph in one call when you know the plan upfront. If a task genuinely can't proceed until a specific real-world time — a scheduled long-running process, a deadline someone gave you, anything with a known future unblock time — call org_task_block instead of leaving it idle: it stops the idle watchdog from nudging you about it and automatically resumes the task when the time arrives, instead of you repeatedly re-confirming "still waiting" every idle cycle.`,
    `Before starting substantial work, call org_recall to check what previous runs already learned or delivered - do not redo finished work.`,
    `The user's documents (notes, handbooks, specs) are searchable with knowledge_search - ground your work in them instead of guessing; results labeled [global] come from the user's personal cross-project brain.`,
    `When you receive a message, act on it, then org_send your result to the requester.`,
    `Your $TMPDIR is private to this session: the org runtime gives every role (every task session, under task scope) its own subdirectory and removes it when the session or task ends, so a bare \`mktemp\` lands there. Never run a cleanup glob (e.g. \`rm -rf tmp.*\`) in a directory other roles also use; delete only the paths you created, by exact name.`,
    `After writing a deliverable file, verify it exists with the expected content (ls -l, or Read it) before you report it done. A refused or failed write is a blocker, not a success: report it as blocked to ${isCoordinator ? 'the human or in your org_complete summary' : 'your lead'}, naming the path and the error, instead of saying "written". The runtime refuses a completion that follows a failed write whose file is not on disk.`,
    isCoordinator
      ? `If the runtime tells you a role never started or has gone silent, do not just wait: reassign its unfinished work to an idle role (create the task for that role with org_task and org_task_cancel the old one) or take it over yourself. Before org_complete, verify every worker's deliverable files exist (ls -l); a deliverable that was not written makes the outcome "partial", not "achieved".`
      : '',
    isCoordinator
      ? `When the org's goal for this run is achieved (or clearly can't be): first call org_learn ONCE with the durable knowledge this run produced, then call org_complete exactly once with the outcome and a concise summary. Then end your turn.`
      : `When your current work is complete and no reply is needed, end your turn without further tool calls.`,
    isCoordinator && glossary?.length
      ? `Known entities (reuse these EXACT names in org_learn instead of near-duplicates): ${glossary.slice(0, 40).join(', ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** The system prompt one session of this role is built with. */
export function rolePromptFor(opts: SessionOpts): string {
  return buildRolePrompt(
    expandRolePromptVars(opts.role, promptVarsFor(opts.orgRoot ?? opts.cwd)),
    (opts.def ?? { name: opts.org, goal: '' }) as OrgDef,
    opts.def?.roles.map((r) => r.id) ?? [opts.role.id],
    opts.glossary,
    // D7: the loadout's text follows the role's own guidance. With no
    // loadout this is exactly resolveRoleExtraGuidance(role), as before.
    [
      resolveRoleExtraGuidance(opts.role, opts.orgRoot ?? opts.cwd),
      opts.loadout?.guidance,
      // Org sections (plan P3.12): only a run with a documents runtime (the role was given a documents host).
      opts.documents && opts.def ? documentGuidance(opts.def, opts.role.id) : undefined,
    ]
      .filter(Boolean)
      .join('\n\n') || undefined,
    opts.onComplete ? endpointBriefingLines(opts.def) : undefined,
  );
}
