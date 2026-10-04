// packages/@monomind/cli/src/orgrt/cross-org-mail.ts
// Split out of cross-org.ts (file-size sweep) — addressing, mailbox bodies,
// and the single entry point into a role's mailbox.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { mailDirFor } from './documents/mail-isolation.js';
import { sectionsSurface } from './documents/surface.js';
import { clearEndpointWait } from './endpoint-roles.js';
import { scanMessage } from './fence.js';
import { parseTraceLine } from './tool-providers.js';
import { ORG_DIR } from './types.js';

/** Bodies larger than this are digested to a .mail file (see mailBody). */
const MAIL_BODY_MAX = 4096;
/** How much of an oversized body stays inline in the digest. */
const MAIL_DIGEST_CHARS = 1024;

/**
 * Resolves an org_send `to` address ("role" for same-org, "org:role" for
 * cross-org) into its parts. Centralizes the one addressing rule that
 * matters (an "own-org:role" self-prefix is intra-org, not cross-org) so
 * deliver()/deliverRemote() don't each re-derive it — the qualified `to`
 * string returned is always the canonical display form for that address.
 */
export function resolveAddress(
  fromOrg: string,
  to: string,
): { cross: boolean; orgName: string; role: string; qualified: string } {
  const cross = to.includes(':');
  if (!cross) return { cross: false, orgName: fromOrg, role: to, qualified: to };
  const [orgName, role] = to.split(':', 2);
  if (orgName === fromOrg) return { cross: false, orgName, role, qualified: role }; // self-prefixed — still intra-org
  return { cross: true, orgName, role, qualified: to };
}

/** Mailbox bodies are unbounded — a pasted 20KB file would persist in the
 *  recipient's context for the whole run. Bodies over MAIL_BODY_MAX are
 *  written to <org workdir>/.mail/<message-id>.md and replaced with a ~1KB
 *  digest plus a pointer; smaller messages stay byte-identical. */
export function mailBody(
  root: string,
  orgName: string,
  org: RunningOrg | undefined,
  header: string,
  body: string,
  id: string,
  toRole?: string,
): string {
  if (body.length <= MAIL_BODY_MAX) return `${header}\n\n${body}`;
  // GA row R3: a sections org digests into the recipient's daemon-owned directory.
  const mailDir =
    toRole && org?.def && sectionsSurface(org.def).enabled
      ? mailDirFor(join(root, ORG_DIR, orgName), toRole)
      : join(org?.workdir ?? join(root, ORG_DIR, orgName), '.mail');
  const file = join(mailDir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`);
  try {
    mkdirSync(mailDir, { recursive: true });
    writeFileSync(file, body);
    return `${header}\n\n${body.slice(0, MAIL_DIGEST_CHARS)}\n\n[... truncated — full text at ${file} — Read it if needed]`;
  } catch {
    return `${header}\n\n${body}`; // digest write failed — deliver in full rather than lose content
  }
}

/** SEC: the ONE place an inter-agent message enters a role's mailbox. Every
 *  inbound path — live deliver(), inbound cross-process receiveRemote(), and
 *  the queued-inbox drains (startOrg, deferred spawns) — must go through here
 *  so a role with `scanMessages` on is fenced on all of them, not just the
 *  first. Returns false when the fence blocked the body (scanMessage already
 *  emitted the audit event) or the recipient can't take mail. */
export async function pushMessage(
  daemon: OrgDaemon,
  orgName: string,
  org: RunningOrg,
  toRole: string,
  from: string,
  subject: string,
  body: string,
  id: string,
): Promise<boolean> {
  const roleFence = org.fences?.get(toRole);
  if (roleFence?.scanMessages) {
    const safe = await scanMessage(
      roleFence.instance,
      body,
      roleFence.abortThreshold,
      org.bus,
      from,
    );
    if (!safe) return false;
  }
  const mail = mailBody(
    daemon.root,
    orgName,
    org,
    `[message from ${from}] subject: ${subject}`,
    body,
    id,
    toRole,
  );
  // A slot mid-replacement has no live mailbox to deliver into safely —
  // route into the slot's swap queue so the REPLACEMENT incarnation gets it
  // instead of it landing in a mailbox about to be torn down (design step 6).
  const slot = org.roleSlots?.get(toRole);
  if (slot?.phase === 'draining') {
    slot.queuedDuringSwap.push(mail);
    recordTrace(org, toRole, body);
    clearEndpointWait(org, orgName, from);
    return true;
  }
  const agent = org.agents.get(toRole);
  if (!agent || agent.mailbox.isClosed) return false;
  // #275: a task auto-dispatched to this role moments ago is still being held
  // for its coalescing window — ride along with it so the recipient's turn
  // opens with the task AND the briefing that accompanies it, instead of the
  // bare title with this body stranded a turn behind.
  const heldDispatch = org.pendingDispatch?.get(toRole);
  if (heldDispatch) heldDispatch.lines.push(mail);
  else agent.mailbox.push(mail);
  recordTrace(org, toRole, body);
  clearEndpointWait(org, orgName, from);
  return true;
}

/** M1: remember the chain trace of the latest traced message a role got. */
function recordTrace(org: RunningOrg, toRole: string, body: string): void {
  const trace = parseTraceLine(body);
  if (!trace) return;
  if (!org.traces) org.traces = new Map();
  org.traces.set(toRole, trace);
}
