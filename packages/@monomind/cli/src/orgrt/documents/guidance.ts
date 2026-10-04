// packages/@monomind/cli/src/orgrt/documents/guidance.ts
//
// The role text of a sections org (org sections plan P3.12, the one intentional prompt change): what a role is
// told about the documents runtime. A pure function of the definition and the role id, appended through the
// existing extra-guidance argument of `buildRolePrompt` only when the run has a documents runtime
// (session-prompt.ts). It returns undefined for an org that is not on the sections surface, so every other org's
// prompt stays byte for byte as it was.
//
// Everything specific is built from the definition (the role's section and lead, the types it produces and
// consumes with their schema summary, evidence, deliverable files and attempt limits); the wording around it is
// the wording the harness measured (tests/eval/org/pilot/harness.ts), written for any org. Compact: one short
// paragraph per duty, at most MAX_TYPES_LISTED types per list.
import type { OrgDef } from '../types.js';
import { DocAccess, sectionRoster } from './access.js';
import { effectiveContract } from './contract.js';
import { schemaSummary } from './guidance-schema.js';
import { rootRoleId, sectionOf, crossSectionRefusal } from './routing.js';
import { bindingsFromDef } from './runtime.js';
import { sectionsSurface } from './surface.js';
import type { DocContract } from './types.js';

export const MAX_TYPES_LISTED = 8;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function listed<T>(items: T[], line: (t: T) => string): string {
  const shown = items.slice(0, MAX_TYPES_LISTED).map(line);
  if (items.length > MAX_TYPES_LISTED)
    shown.push(`and ${items.length - MAX_TYPES_LISTED} more (org_doc_list shows them all)`);
  return shown.join('\n');
}

function evidenceText(c: DocContract): string {
  return c.evidence.length
    ? `evidence entries (objects with a kind): ${c.evidence.map((e) => `${e.min} ${e.kind}`).join(', ')}`
    : 'no evidence required';
}

function filesText(c: DocContract): string {
  if (!c.deliverable_files.length) return '';
  const files = c.deliverable_files.map((d) => d.file).slice(0, 3);
  const more = c.deliverable_files.length > 3 ? ` and ${c.deliverable_files.length - 3} more` : '';
  return `; the body must agree with your files ${files.join(', ')}${more}`;
}

/** The text for `roleId`, or undefined when the org is not on the sections surface or has no such role. */
export function documentGuidance(def: OrgDef, roleId: string): string | undefined {
  if (!sectionsSurface(def).enabled) return undefined;
  const role = def.roles.find((r) => r.id === roleId);
  if (!role) return undefined;

  const bindings = bindingsFromDef(def);
  const access = new DocAccess(def, bindings);
  const contracts = new Map(bindings.map((b) => [b.contract.type, effectiveContract(b.contract)]));
  const bindingOf = new Map(bindings.map((b) => [b.contract.type, b]));
  const root = rootRoleId(def);
  const isRoot = roleId === root;
  const section = sectionOf(def, roleId);
  const sections = (isObject(def.sections) ? def.sections : {}) as Record<string, Record<string, unknown>>;
  const leadOf = (name: string): string =>
    typeof sections[name]?.lead === 'string' ? (sections[name].lead as string) : sectionRoster(def, name)[0];
  const isManager = def.roles.some((r) => r.reports_to === roleId);

  const types = [...contracts.keys()];
  const produces = types.filter((t) => access.roleFor(roleId, t) === 'producer');
  const decides = types.filter((t) => access.roleFor(roleId, t) === 'consumer-lead');
  const reads = types.filter((t) => access.roleFor(roleId, t) === 'consumer');

  const out: string[] = ['## Documents between sections'];
  out.push(
    isRoot
      ? 'You are the root: in no section. You read every document and may message any role.'
      : section
        ? `You are in section "${section}" (lead: ${leadOf(section)}${leadOf(section) === roleId ? ', that is you' : ''}).`
        : 'You are in no section.',
  );
  out.push(
    isRoot
      ? `Work crosses sections as documents, not messages: org_send from a role to a role in another section is refused, and only you can reach any section. Documents live in the runtime's store, not in your workspace: only the org_doc_* tools reach them (org_doc_list shows every document).`
      : section
        ? `Work crosses sections as documents, not messages: org_send to a role in another section is refused (the root can reach any section), so use org_send only within your section and publish what another section needs. Documents live in the runtime's store, not in your workspace: only the org_doc_* tools reach them (org_doc_list shows what you may read).`
        : "Documents live in the runtime's store, not in your workspace: only the org_doc_* tools reach them. You publish and decide none (org_doc_list shows anything you may read); you may message any role.",
  );

  if (produces.length) {
    const cs = produces.map((t) => contracts.get(t) as DocContract);
    out.push(
      `You publish:\n${listed(cs, (c) => `- ${c.type}: ${schemaSummary(c.schema)}; ${evidenceText(c)}${filesText(c)}; ${c.max_publish_attempts} publish attempts, for consumer(s) ${(bindingOf.get(c.type)?.consumers ?? []).map((x) => x.id).join(', ')}.`)}`,
    );
    const manager = role.reports_to;
    const tell =
      manager && !crossSectionRefusal(def, roleId, manager)
        ? `, then tell "${manager}" it is published`
        : '';
    out.push(
      `Write any deliverable file first and verify it on disk (ls -l, or Read it) before you publish. Publish with org_doc_publish (type, body as a JSON object, evidence)${tell}. A body that does not match the contract${cs.some((c) => c.deliverable_files.length) ? ' or disagrees with your deliverable files' : ''} is refused with every problem named and uses one attempt: fix them all, then publish again. Repeating an identical publish call is safe.`,
    );
    out.push(
      `When a consumer rejects a version, a message from the runtime ("document rejected: <id> v<n>") tells you directly (document, version, reason, attempts left)${cs.some((c) => c.deliverable_files.length) ? ', and so does a change to a deliverable file after you published ("document needs republishing")' : ''}: fix the underlying files if they were wrong and publish a corrected version with supersedes set to the head id@vN. Nobody has to relay it. When no attempts are left, report the blocker to your lead instead of publishing.`,
    );
  }

  if (decides.length) {
    const hasChecks = decides.some((t) => (contracts.get(t) as DocContract).checks.length);
    out.push(
      `You decide for section "${section}" on:\n${listed(decides, (t) => `- ${t}, published by section ${bindingOf.get(t)?.section}`)}`,
    );
    out.push(
      `A message from the runtime ("document ready: <id> v<n>") wakes you each time one is published, so do not poll: if nothing is published yet, end your turn. On a notice read that version (org_doc_read)${hasChecks ? ', run org_doc_check on it (a necessary check against the document\'s own evidence, not a sufficient one: spot-check what you rely on against the source)' : ''}, then decide with org_doc_decide: accept, or reject with a reason the producer can act on. A rejection reaches the producer directly: do not ask anyone to relay it. A decision is per version: a corrected version supersedes the old one and needs its own decision. A document counts as accepted only when every consuming section accepts it; start your final work from accepted versions only.`,
    );
  }

  if (reads.length)
    out.push(
      `Your section consumes:\n${listed(reads, (t) => `- ${t}, published by section ${bindingOf.get(t)?.section}`)}\nOnly your section lead decides on them; you read accepted versions only.`,
    );

  const reportsOf = (pick: (id: string) => boolean) =>
    isRoot || def.roles.some((r) => r.reports_to === roleId && pick(r.id));
  if (isManager || isRoot) {
    const lead: string[] = [];
    if (reportsOf((id) => access.publishable(id).length > 0))
      lead.push(
        'you are not asked to relay rejections (the runtime tells the producer directly and sends you a short copy, to act on only if the producer goes quiet)',
      );
    if (reportsOf((id) => types.some((t) => access.roleFor(id, t) === 'consumer-lead')))
      lead.push(
        'on a "[watch]" message that a document has gone unread, wait, nudge the named roles with org_send, or take over by reassigning the review',
      );
    lead.push(
      'if a role never started or has gone silent, reassign its unfinished work to an idle role instead of waiting',
    );
    out.push(`As a lead: ${lead.join('; ')}.`);
  }
  return out.join('\n');
}
