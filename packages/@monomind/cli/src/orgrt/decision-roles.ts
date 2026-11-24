// packages/@monomind/cli/src/orgrt/decision-roles.ts
/**
 * Decision roles (#835 PR 6). A role with `kind: "decision"` is not an agent: it has no session,
 * mailbox, slot or budget. Mail addressed to it is put to a decision provider (jev-providers
 * registry) as one question. Above `decision.threshold` the role replies at once, from itself,
 * with text built from the enumerated option, never from provider text. Below it, or when the
 * provider is unavailable, says nothing usable or answers off the menu, the original mail goes
 * to `decision.fallback_role`. An answer with probSource `none` is never above threshold.
 *
 * Same-org mail only: a decision role refuses cross-org and remote mail (resolved decision).
 */
import {
  type JevAskOptions,
  type JevAskResult,
  type JevProvider,
  type JevQuestion,
  jevModule,
} from '../decision/jev.js';
import type { RunningOrg } from './daemon.js';
import type { OrgDef, OrgRole } from './types.js';

export const DECISION_TIMEOUT_MS = 10_000;
export const QUESTION_ID = 'decision';
const MAX_STATE_CHARS = 8000;

/** Keys a decision role may not carry (it is not an agent). */
export const DECISION_FORBIDDEN_KEYS = [
  'policy',
  'runtime',
  'adapter_config',
  'budget_tokens',
  'budget_usd',
  'tool_providers',
] as const;

export function isDecisionRole(role: unknown): boolean {
  return (role as { kind?: unknown } | undefined)?.kind === 'decision';
}

export function findDecisionRole(
  def: Pick<OrgDef, 'roles'> | undefined,
  roleId: string,
): OrgRole | undefined {
  const role = def?.roles.find((r) => r.id === roleId);
  return role && isDecisionRole(role) ? role : undefined;
}

/** `org validate` rules for decision roles. */
export function decisionStructureErrors(def: Pick<OrgDef, 'roles'>): string[] {
  const errors: string[] = [];
  for (const r of def.roles) {
    if (!isDecisionRole(r)) continue;
    const rec = r as Record<string, unknown>;
    if (r.reports_to === null) errors.push(`decision role "${r.id}" may not be the root role`);
    for (const k of DECISION_FORBIDDEN_KEYS)
      if (rec[k] !== undefined) errors.push(`decision role "${r.id}" may not have "${k}"`);
    const fb = r.decision?.fallback_role;
    if (fb === undefined) continue;
    const target = def.roles.find((x) => x.id === fb);
    if (!target) errors.push(`decision role "${r.id}": fallback_role "${fb}" matches no role id`);
    else if (isDecisionRole(target))
      errors.push(`decision role "${r.id}": fallback_role "${fb}" may not be a decision role`);
  }
  return errors;
}

/** Boss briefing: one line per decision role. */
export function decisionBriefingLines(def: Pick<OrgDef, 'roles'> | undefined): string[] {
  if (!def) return [];
  return def.roles.filter(isDecisionRole).map((r) => {
    const d = r.decision;
    const options =
      d?.question === 'choice' ? ` Options: ${Object.keys(d.criteria).join(', ')}.` : '';
    return `- ${r.id} (${r.title || r.type}) is an automated decision service, not an agent. Message it with org_send; it answers at once when confident, otherwise your message goes to ${d?.fallback_role}.${options}`;
  });
}

// ── Delivery ─────────────────────────────────────────────────────────────

export type DecisionSend = (
  fromRole: string,
  to: string,
  subject: string,
  body: string,
) => Promise<string>;

export interface DecisionDeps {
  /** Routes one same-org message (the daemon's deliver). */
  send: DecisionSend;
  ask?: (
    state: string,
    questions: Record<string, JevQuestion>,
    opts?: JevAskOptions,
  ) => Promise<JevAskResult | null>;
  /** The named provider's config, or undefined when it is not configured. */
  resolveProvider?: (name: string) => JevProvider | undefined;
}

export interface DecisionArgs {
  orgName: string;
  org: RunningOrg;
  role: OrgRole;
  /** Sender: a bare role id of this org. */
  from: string;
  subject: string;
  body: string;
  messageId: string;
  /** `to` on the emitted event (deliver()'s display form). */
  eventTo?: string;
}

type Verdict =
  | { above: true; reply: string; detail: Record<string, unknown> }
  | { above: false; why: string };

function buildQuestion(d: NonNullable<OrgRole['decision']>): JevQuestion {
  if (d.question === 'choice')
    return {
      type: 'choice',
      instructions: d.instructions ?? 'Which option best answers the message?',
      criteria: d.criteria,
    };
  return {
    type: d.question,
    instructions:
      d.instructions ?? 'How strongly does the message call for a yes? Answer 0 (no) to 1 (yes).',
  };
}

/** Judge one provider answer. Reply text comes only from the role's own config. */
function judge(role: OrgRole, result: JevAskResult | null): Verdict {
  const d = role.decision!;
  const a = result?.answers?.[QUESTION_ID];
  if (!a || a.type !== d.question) return { above: false, why: 'no usable answer' };
  const source = a.probSource ?? 'none';
  if (source === 'none') return { above: false, why: 'answer carries no probability' };
  if (d.question === 'choice') {
    const { choice, confidence } = a;
    if (typeof choice !== 'string' || !Object.hasOwn(d.criteria, choice))
      return { above: false, why: 'answer is not one of the options' };
    if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < d.threshold)
      return { above: false, why: `confidence below threshold ${d.threshold}` };
    return {
      above: true,
      reply: `Decision from ${role.id}: ${choice} (${d.criteria[choice]}). Confidence ${confidence.toFixed(2)}.`,
      detail: { choice, confidence, probSource: source },
    };
  }
  const v = a.noul;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1 || v < d.threshold)
    return { above: false, why: `score below threshold ${d.threshold}` };
  return {
    above: true,
    reply: `Decision from ${role.id}: yes (${d.question} ${v.toFixed(2)}).`,
    detail: { score: v, probSource: source },
  };
}

/** Put one question to the role's provider. `why` names every way it can come back empty. */
export async function askRole(
  role: OrgRole,
  state: string,
  deps: Pick<DecisionDeps, 'ask' | 'resolveProvider'>,
): Promise<{ result: JevAskResult | null } | { why: string }> {
  const d = role.decision!;
  const mod = jevModule();
  const resolve =
    deps.resolveProvider ??
    ((n: string) => mod?.resolveProviders(process.env).find((p) => p.name === n));
  const ask = deps.ask ?? mod?.ask?.bind(mod);
  const base = resolve(d.provider);
  if (!ask || !base) return { why: `provider "${d.provider}" is not available` };
  const redact = mod?.redactSecrets ?? ((t: string) => t);
  try {
    const provider = { ...base, model: d.model ?? base.model };
    const result = await ask(
      redact(state).slice(0, MAX_STATE_CHARS),
      { [QUESTION_ID]: buildQuestion(d) },
      { providers: [provider], timeoutMs: DECISION_TIMEOUT_MS },
    );
    return { result };
  } catch (err) {
    return { why: `provider failed: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function consult(role: OrgRole, state: string, deps: DecisionDeps): Promise<Verdict> {
  const asked = await askRole(role, state, deps);
  return 'why' in asked ? { above: false, why: asked.why } : judge(role, asked.result);
}

/** deliver() leg for a target that is a decision role: answer, or forward to fallback_role. */
export async function deliverToDecision(args: DecisionArgs, deps: DecisionDeps): Promise<string> {
  const { orgName, org, role, from, subject, body, messageId } = args;
  const to = `${orgName}:${role.id}`;
  if (from.includes(':'))
    return `REFUSED: decision role "${to}" does not take cross-org mail (sender ${from}); message it from inside ${orgName}.`;
  org.bus.emit({
    type: 'message',
    from,
    to: args.eventTo ?? to,
    subject,
    msg: body,
    data: { messageId, decision: true },
  });
  const verdict = await consult(role, `Subject: ${subject}\n\n${body}`, deps);
  if (verdict.above) {
    await deps.send(role.id, from, `Re: ${subject}`, verdict.reply);
    org.bus.emit({
      type: 'audit',
      from: role.id,
      reason: 'decision-answered',
      msg: `decision role "${role.id}" answered ${from}: ${subject}`,
      data: { role: role.id, messageId, ...verdict.detail },
    });
    return `delivered to ${to} (decision: answered)`;
  }
  const fallback = role.decision!.fallback_role;
  await deps.send(
    from,
    fallback,
    `[via ${role.id}] ${subject}`,
    `(Forwarded by decision role "${role.id}": ${verdict.why}.)\n\n${body}`,
  );
  org.bus.emit({
    type: 'audit',
    from: role.id,
    reason: 'decision-forwarded',
    msg: `decision role "${role.id}" forwarded mail from ${from} to ${fallback}: ${verdict.why}`,
    data: { role: role.id, messageId, fallback, why: verdict.why },
  });
  return `delivered to ${to} (decision: forwarded to ${fallback})`;
}
