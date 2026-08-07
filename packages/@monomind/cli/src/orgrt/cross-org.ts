// packages/@monomind/cli/src/orgrt/cross-org.ts
// Extracted from daemon.ts — message delivery, cross-org routing, remote delivery.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lookupOrg, normalizeCredential } from './broker.js';
import { queueMessage } from './inbox.js';
import { checkResources, waitForCapacity } from '../utils/resource-governor.js';
import { ORG_DIR } from './types.js';
import type { OrgDaemon, RunningOrg } from './daemon.js';

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
export function resolveAddress(fromOrg: string, to: string): { cross: boolean; orgName: string; role: string; qualified: string } {
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
export function mailBody(root: string, orgName: string, org: RunningOrg | undefined, header: string, body: string, id: string): string {
  if (body.length <= MAIL_BODY_MAX) return `${header}\n\n${body}`;
  const mailDir = join(org?.workdir ?? join(root, ORG_DIR, orgName), '.mail');
  const file = join(mailDir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`);
  try {
    mkdirSync(mailDir, { recursive: true });
    writeFileSync(file, body);
    return `${header}\n\n${body.slice(0, MAIL_DIGEST_CHARS)}\n\n[... truncated — full text at ${file} — Read it if needed]`;
  } catch {
    return `${header}\n\n${body}`; // digest write failed — deliver in full rather than lose content
  }
}

/** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
export async function deliver(daemon: OrgDaemon, fromOrg: string, fromRole: string, to: string, subject: string, body: string): Promise<string> {
  const { cross, orgName: targetOrgName, role: targetRole, qualified: toQualified } = resolveAddress(fromOrg, to);
  const targetOrg = daemon.orgs.get(targetOrgName);
  const src = daemon.orgs.get(fromOrg);
  // Lazy spawn: if the role is pending (not yet spawned), spawn it now.
  // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
  const spawning = daemon.spawning.get(targetOrgName) ?? new Set<string>();
  daemon.spawning.set(targetOrgName, spawning);
  if (targetOrg && !targetOrg.agents.has(targetRole) && targetOrg.pendingRoles?.has(targetRole) && !spawning.has(targetRole)) {
    const role = targetOrg.pendingRoles.get(targetRole)!;
    targetOrg.pendingRoles.delete(targetRole);
    spawning.add(targetRole); // Mark as spawning before async work
    const check = checkResources();
    if (!check.ok) {
      const waited = await waitForCapacity(60_000);
      spawning.delete(targetRole); // Clear spawning flag after check
      if (!waited.ok) {
        targetOrg.bus.emit({ type: 'audit', from: targetRole, reason: 'resource-skip',
          msg: `deferring lazy spawn of "${targetRole}": ${waited.reason}` });
        // Queue the triggering message so it survives the deferred spawn — without
        // this the sender got "queued" but the message was silently lost.
        // B5 FIX: Queue FIRST, then schedule spawn only if queue succeeds.
        // If queueing fails, we return the error without modifying spawn state.
        const queued = queueMessage(daemon.root, targetOrgName, {
          fromQualified: cross ? `${fromOrg}:${fromRole}` : fromRole,
          toRole: targetRole, subject, body, ts: Date.now(),
        });
        if (!queued) {
          src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
          return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
        }
        daemon.scheduleDeferredSpawn(targetOrgName, targetOrg, role, targetOrg.spawnRole!);
        return `queued for ${toQualified} (role starting — waiting for resources)`;
      }
    }
    targetOrg.spawnRole!(role);
    spawning.delete(targetRole); // Clear spawning flag after spawn completes
    targetOrg.bus.emit({ type: 'status', from: targetRole, msg: `lazy-spawned on first message from ${fromRole}` });
  }
  if (!targetOrg || !targetOrg.agents.has(targetRole)) {
    if (cross && daemon.opts.crossProcess) return deliverRemote(daemon, fromOrg, fromRole, targetOrgName, targetRole, toQualified, subject, body, src);
    // Queue + auto-wake: if the org definition exists locally but isn't running, spool the message and start it
    if (cross && daemon.hasOrgDef(targetOrgName)) {
      const queued = queueMessage(daemon.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
      if (!queued) {
        src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
        return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
      }
      src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to: toQualified, subject, msg: body, data: { queued: true } });
      daemon.autoWake(targetOrgName);
      return `queued for ${toQualified} (org starting)`;
    }
    src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
    return `ERROR: unknown recipient "${toQualified}" (known: ${[...(targetOrg?.agents.keys() ?? daemon.orgs.keys())].join(', ')})`;
  }
  const targetAgent = targetOrg.agents.get(targetRole)!;
  if (targetAgent.status === 'crashed') {
    src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'recipient crashed (retry budget exhausted)' });
    return `ERROR: recipient "${toQualified}" crashed and will not recover this run — message not delivered (${targetAgent.error ?? 'unknown error'})`;
  }
  if (targetAgent.mailbox.isClosed) {
    // Distinguish two cases that used to share one drop:
    //  - org mid-shutdown: nothing will ever read the queue again — the
    //    message genuinely can't be delivered, so report the real outcome.
    //  - agent session ended but the org is alive (budget exhaustion,
    //    turn limit, crash-restart in flight): the result is still
    //    valuable, so persist it to the inbox. The boss-restart/next-run
    //    drainInbox will deliver it instead of the work vanishing.
    if (daemon.stopping.has(targetOrgName)) {
      src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `undeliverable: ${subject}`, reason: 'target mailbox closed (org shutting down)' });
      return `ERROR: recipient "${toQualified}" is shutting down — message not delivered`;
    }
    const q = queueMessage(daemon.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
    src?.bus.emit({ type: 'audit', from: fromRole, to: toQualified, msg: `recipient session closed — queued to inbox: ${subject}`, data: { queued: q } });
    return `queued to inbox for ${toQualified} (recipient session closed; will be delivered on restart)`;
  }
  // Track message chain: link this message to the target's last message (the one being responded to)
  const targetAgentSrc = targetOrg === src ? src?.agents.get(targetRole) : undefined;
  const parentId = targetAgentSrc?.lastMessageId;
  const evt = { from: cross ? `${fromOrg}:${fromRole}` : fromRole, to: toQualified, subject, msg: body, parentId };
  const emitted = src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
  if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
  // Store message ID for the target (so responses can link to it)
  if (targetAgentSrc && emitted) targetAgentSrc.lastMessageId = emitted.id;
  // Also track the source agent's last sent message for cross-org visibility
  const srcAgent = src?.agents.get(fromRole);
  if (srcAgent && emitted) srcAgent.lastMessageId = emitted.id;
  targetAgent.mailbox.push(mailBody(daemon.root, targetOrgName, targetOrg, `[message from ${evt.from}] subject: ${subject}`, body,
    emitted?.id ?? `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`));
  return `delivered to ${toQualified}`;
}

/** Cross-process leg of deliver(): ask the machine-local broker who hosts targetOrgName, then POST over HTTP.
 *  `to` here is always the fully-qualified "org:role" display form (resolveAddress already normalized it). */
async function deliverRemote(
  daemon: OrgDaemon, fromOrg: string, fromRole: string, targetOrgName: string, targetRole: string,
  to: string, subject: string, body: string, src: RunningOrg | undefined,
): Promise<string> {
  const remote = lookupOrg(targetOrgName, daemon.opts.brokerDir);
  if (!remote) {
    // No remote host either — queue + auto-wake if the org def exists locally
    if (daemon.hasOrgDef(targetOrgName)) {
      const queued = queueMessage(daemon.root, targetOrgName, { fromQualified: `${fromOrg}:${fromRole}`, toRole: targetRole, subject, body, ts: Date.now() });
      if (!queued) {
        src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `queue failed: ${subject}`, reason: 'queue-failed' });
        return `ERROR: could not queue message for ${to} (disk full or permissions)`;
      }
      src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body, data: { queued: true } });
      daemon.autoWake(targetOrgName);
      return `queued for ${to} (org starting)`;
    }
    // Check SSH remote host registry before giving up
    try {
      const { lookupRemoteOrg, deliverRemote: sshDeliver } = await import('./remote.js');
      const remoteHost = lookupRemoteOrg(targetOrgName, daemon.root);
      if (remoteHost) {
        const result = await sshDeliver(targetOrgName, `${fromOrg}:${fromRole}`, subject, body, remoteHost);
        if (result.ok) {
          src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body, data: { remote: 'ssh', host: remoteHost.host } });
          return `delivered to ${to} via SSH (${remoteHost.host})`;
        }
        src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `SSH delivery failed: ${result.output}`, reason: 'ssh-delivery-failed' });
        return `ERROR: SSH delivery to "${to}" on ${remoteHost.host} failed: ${result.output}`;
      }
    } catch { /* remote.ts unavailable or SSH not configured — fall through */ }
    src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `undeliverable: ${subject}`, reason: 'unknown recipient' });
    return `ERROR: unknown recipient "${to}" (no local org, no process on this machine, and no SSH remote configured for "${targetOrgName}")`;
  }
  try {
    const res = await fetch(`${remote.url}/api/xdeliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(remote.credential ? { 'x-monomind-cred': remote.credential } : {}),
      },
      body: JSON.stringify({ fromOrg, fromRole, toOrg: targetOrgName, toRole: targetRole, subject, body }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = await res.json().catch(() => ({})) as { ok?: boolean; receipt?: string; error?: string };
    if (res.ok && data.ok) {
      src?.bus.emit({ type: 'xorg', from: `${fromOrg}:${fromRole}`, to, subject, msg: body });
      return data.receipt ?? `delivered to ${to} (remote)`;
    }
    src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery rejected: ${data.error ?? res.status}`, reason: 'remote-delivery-rejected' });
    return `ERROR: remote org "${to}" rejected delivery: ${data.error ?? res.status}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    src?.bus.emit({ type: 'audit', from: fromRole, to, msg: `remote delivery failed: ${message}`, reason: 'remote-delivery-failed' });
    return `ERROR: remote org "${targetOrgName}" unreachable: ${message}`;
  }
}

/** Inbound handler for cross-process delivery — called by the server's POST /api/xdeliver route
 *  when ANOTHER process's deliverRemote() reaches this daemon. Pushes straight into the target
 *  agent's mailbox; the agent picks it up on its own next turn (see Mailbox — never interrupts). */
export function receiveRemote(
  daemon: OrgDaemon, toOrg: string, toRole: string, fromQualified: string, subject: string, body: string,
): { ok: true; receipt: string } | { ok: false; error: string } {
  const org = daemon.orgs.get(toOrg);
  if (!org) {
    // Org not running — queue the message and auto-wake if the def exists
    if (daemon.hasOrgDef(toOrg)) {
      const queued = queueMessage(daemon.root, toOrg, { fromQualified, toRole, subject, body, ts: Date.now() });
      if (!queued) {
        return { ok: false, error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)` };
      }
      daemon.autoWake(toOrg);
      return { ok: true, receipt: `queued for ${toOrg}:${toRole} (org waking)` };
    }
    return { ok: false, error: `org "${toOrg}" not hosted here` };
  }
  // Lazy-spawn pending roles on cross-process delivery (matches deliver/answerQuestion)
  // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
  const spawning = daemon.spawning.get(toOrg) ?? new Set<string>();
  daemon.spawning.set(toOrg, spawning);
  if (!org.agents.has(toRole) && org.pendingRoles?.has(toRole) && !spawning.has(toRole)) {
    const role = org.pendingRoles.get(toRole)!;
    org.pendingRoles.delete(toRole);
    spawning.add(toRole); // Mark as spawning before async work
    // Resource gate check before spawning (prevents bypass in cross-process delivery)
    const check = checkResources();
    if (!check.ok) {
      spawning.delete(toRole); // Clear spawning flag after check
      org.bus.emit({ type: 'audit', from: toRole, reason: 'resource-pressure',
        msg: `cross-process lazy spawn deferred: ${check.reason}` });
      // B4 FIX: Queue the triggering message FIRST, then schedule spawn only if queue succeeds.
      // This matches the pattern in deliver() and prevents message loss if queue fails.
      const queued = queueMessage(daemon.root, toOrg, { fromQualified, toRole, subject, body, ts: Date.now() });
      if (!queued) {
        return { ok: false, error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)` };
      }
      daemon.scheduleDeferredSpawn(toOrg, org, role, org.spawnRole!);
      return { ok: true, receipt: `queued for ${toOrg}:${toRole} (role starting — waiting for resources)` };
    }
    org.spawnRole?.(role);
    spawning.delete(toRole); // Clear spawning flag after spawn completes
    org.bus.emit({ type: 'status', from: toRole, msg: `lazy-spawned on remote delivery from ${fromQualified}` });
  }
  const agent = org.agents.get(toRole);
  if (!agent) return { ok: false, error: `role "${toRole}" not found in org "${toOrg}"` };
  if (agent.status === 'crashed') return { ok: false, error: `role "${toRole}" in org "${toOrg}" crashed and will not recover this run` };
  if (agent.mailbox.isClosed) return { ok: false, error: `role "${toRole}" in org "${toOrg}" is shutting down` };
  const messageEvent = org.bus.emit({ type: 'xorg', from: fromQualified, to: `${toOrg}:${toRole}`, subject, msg: body });
  agent.lastMessageId = messageEvent.id; // Track last message ID for response threading
  agent.mailbox.push(mailBody(daemon.root, toOrg, org, `[message from ${fromQualified}] subject: ${subject}`, body, messageEvent.id));
  return { ok: true, receipt: `delivered to ${toOrg}:${toRole} (remote)` };
}
