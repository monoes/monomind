// packages/@monomind/cli/src/orgrt/cross-org-remote.ts
// Split out of cross-org.ts (file-size sweep) — cross-process delivery: the
// outbound leg (deliverRemote) and the inbound handler (receiveRemote).
import { timingSafeEqual } from 'node:crypto';
import { checkResources } from '../shared/resource-governor.js';
import { lookupOrg, normalizeRoot } from './broker.js';
import { clearDeferredSpawn, isDeferredSpawn, markDeferredSpawn } from './cross-org-deferred.js';
import { federationAllows, federationDef, federationDenied } from './cross-org-federation.js';
import { pushMessage } from './cross-org-mail.js';
import { activeRoleCount, type OrgDaemon, type RunningOrg } from './daemon.js';
import { deliverToEndpoint, findEndpointRole } from './endpoint-roles.js';
import { newMessageId, queueMessage } from './inbox.js';

/** Cross-process leg of deliver(): ask the machine-local broker who hosts targetOrgName, then POST over HTTP.
 *  `to` here is always the fully-qualified "org:role" display form (resolveAddress already normalized it). */
export async function deliverRemote(
  daemon: OrgDaemon,
  fromOrg: string,
  fromRole: string,
  targetOrgName: string,
  targetRole: string,
  to: string,
  subject: string,
  body: string,
  src: RunningOrg | undefined,
  messageId: string,
): Promise<string> {
  const remote = lookupOrg(targetOrgName, daemon.opts.brokerDir);
  if (!remote) {
    // No remote host either — queue + auto-wake if the org def exists locally
    if (daemon.hasOrgDef(targetOrgName)) {
      const queued = queueMessage(daemon.root, targetOrgName, {
        fromQualified: `${fromOrg}:${fromRole}`,
        toRole: targetRole,
        subject,
        body,
        ts: Date.now(),
        messageId,
      });
      if (!queued) {
        src?.bus.emit({
          type: 'audit',
          from: fromRole,
          to,
          msg: `queue failed: ${subject}`,
          reason: 'queue-failed',
        });
        return `ERROR: could not queue message for ${to} (disk full or permissions)`;
      }
      src?.bus.emit({
        type: 'xorg',
        from: `${fromOrg}:${fromRole}`,
        to,
        subject,
        msg: body,
        data: { queued: true, messageId },
      });
      daemon.autoWake(targetOrgName);
      return `queued for ${to} (org starting)`;
    }
    // Check SSH remote host registry before giving up
    try {
      const { lookupRemoteOrg, deliverRemote: sshDeliver } = await import('./remote.js');
      const remoteHost = lookupRemoteOrg(targetOrgName, daemon.root);
      if (remoteHost) {
        // M4: another host is always another trust domain.
        const denied = federationDenied(daemon, fromOrg, fromRole, targetOrgName, to, subject, src);
        if (denied) return denied;
        const result = await sshDeliver(
          targetOrgName,
          `${fromOrg}:${fromRole}`,
          subject,
          body,
          remoteHost,
        );
        if (result.ok) {
          src?.bus.emit({
            type: 'xorg',
            from: `${fromOrg}:${fromRole}`,
            to,
            subject,
            msg: body,
            data: { remote: 'ssh', host: remoteHost.host, messageId },
          });
          return `delivered to ${to} via SSH (${remoteHost.host})`;
        }
        src?.bus.emit({
          type: 'audit',
          from: fromRole,
          to,
          msg: `SSH delivery failed: ${result.output}`,
          reason: 'ssh-delivery-failed',
        });
        return `ERROR: SSH delivery to "${to}" on ${remoteHost.host} failed: ${result.output}`;
      }
    } catch {
      /* remote.ts unavailable or SSH not configured — fall through */
    }
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to,
      msg: `undeliverable: ${subject}`,
      reason: 'unknown recipient',
    });
    return `ERROR: unknown recipient "${to}" (no local org, no process on this machine, and no SSH remote configured for "${targetOrgName}")`;
  }
  // M4: a target under a different project root is another trust domain —
  // honour the sender's federation.allow_to. Same root is never restricted.
  if (remote.root !== normalizeRoot(daemon.root)) {
    const denied = federationDenied(daemon, fromOrg, fromRole, targetOrgName, to, subject, src);
    if (denied) return denied;
  }
  try {
    // BUG 2 FIX: attach fromOrg's OWN registered credential as proof of
    // sender identity — separate from the `x-monomind-cred` header above,
    // which only proves the caller can reach the RECEIVING daemon, not who
    // it claims to be. receiveRemote() looks this org up in the same broker
    // registry and rejects the message if it doesn't match.
    const fromEntry = lookupOrg(fromOrg, daemon.opts.brokerDir);
    const res = await fetch(`${remote.url}/api/xdeliver`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(remote.credential ? { 'x-monomind-cred': remote.credential } : {}),
      },
      body: JSON.stringify({
        fromOrg,
        fromRole,
        fromCredential: fromEntry?.credential,
        fromRoot: normalizeRoot(daemon.root),
        toOrg: targetOrgName,
        toRole: targetRole,
        subject,
        body,
        messageId,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      receipt?: string;
      error?: string;
    };
    if (res.ok && data.ok) {
      src?.bus.emit({
        type: 'xorg',
        from: `${fromOrg}:${fromRole}`,
        to,
        subject,
        msg: body,
        data: { messageId },
      });
      return data.receipt ?? `delivered to ${to} (remote)`;
    }
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to,
      msg: `remote delivery rejected: ${data.error ?? res.status}`,
      reason: 'remote-delivery-rejected',
    });
    return `ERROR: remote org "${to}" rejected delivery: ${data.error ?? res.status}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to,
      msg: `remote delivery failed: ${message}`,
      reason: 'remote-delivery-failed',
    });
    return `ERROR: remote org "${targetOrgName}" unreachable: ${message}`;
  }
}

/** SEC: constant-time credential compare (same shape as server.ts's safeEq) —
 *  a plain `!==` short-circuits on the first differing byte, which lets a
 *  caller time responses to recover the sender credential byte by byte. */
function credentialMatches(supplied: unknown, expected: string): boolean {
  const a = Buffer.from(String(supplied ?? ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export interface ReceiveRemoteOpts {
  /** The caller presented the OPERATOR credential: skip the broker sender
   *  identity check and trust `fromQualified` as given (M3). */
  operator?: boolean;
  /** Origin message id (M3) — generated here when the sender sent none. */
  messageId?: string;
  /** M4: the sending daemon's project root (xdeliver body `fromRoot`). */
  fromRoot?: string;
}

/** Inbound handler for cross-process delivery — called by the server's POST /api/xdeliver route
 *  when ANOTHER process's deliverRemote() reaches this daemon. Pushes straight into the target
 *  agent's mailbox; the agent picks it up on its own next turn (see Mailbox — never interrupts). */
export async function receiveRemote(
  daemon: OrgDaemon,
  toOrg: string,
  toRole: string,
  fromQualified: string,
  subject: string,
  body: string,
  fromCredential?: string,
  opts: ReceiveRemoteOpts = {},
): Promise<{ ok: true; receipt: string } | { ok: false; error: string }> {
  const messageId = opts.messageId ?? newMessageId();
  // BUG 2 FIX: the HTTP auth gate in server.ts only proves the caller knows a
  // credential this daemon accepts (the target org's, or the operator's) — it
  // says nothing about who the caller claims to be. Verify the claimed sender
  // actually owns the credential registered for it in the broker before
  // trusting anything else. Credentials are per-org, so a sibling org hosted
  // by the same daemon can't reuse its own to pass as `fromOrg`.
  //
  // M3: an OPERATOR-authenticated call (server.ts saw the operator credential)
  // carries human authority and may speak as any sender — the org need not be
  // registered (e.g. `workflow:<exec>` or an automation role's reply).
  const claimedFromOrg = fromQualified.split(':', 1)[0];
  if (!opts.operator) {
    const fromEntry = lookupOrg(claimedFromOrg, daemon.opts.brokerDir);
    if (!fromEntry?.credential || !credentialMatches(fromCredential, fromEntry.credential)) {
      return {
        ok: false,
        error: `sender "${claimedFromOrg}" failed identity verification (unregistered or credential mismatch)`,
      };
    }
    // M4 federation (operator-authenticated calls are exempt).
    const fromRoot = opts.fromRoot ? normalizeRoot(opts.fromRoot) : undefined;
    const reject = (error: string) => {
      daemon.orgs.get(toOrg)?.bus.emit({
        type: 'audit',
        from: toRole,
        reason: 'federation-denied',
        msg: `${error} (from ${fromQualified})`,
        data: { direction: 'from', from: fromQualified, fromRoot: fromRoot ?? null },
      });
      return { ok: false as const, error };
    };
    // A sender that states no root (an older daemon, a hand-rolled client)
    // is not a mismatch — it is simply treated as another root below.
    if (fromEntry.root && fromRoot !== undefined && fromRoot !== fromEntry.root)
      return reject('federation: root mismatch');
    if (fromRoot !== normalizeRoot(daemon.root)) {
      const allowFrom = federationDef(daemon, toOrg)?.federation?.allow_from;
      if (!federationAllows(allowFrom, claimedFromOrg))
        return reject('federation: sender not allowed');
    }
  }
  const org = daemon.orgs.get(toOrg);
  if (!org) {
    // Org not running — queue the message and auto-wake if the def exists
    if (daemon.hasOrgDef(toOrg)) {
      const queued = queueMessage(daemon.root, toOrg, {
        fromQualified,
        toRole,
        subject,
        body,
        ts: Date.now(),
        messageId,
      });
      if (!queued) {
        return {
          ok: false,
          error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)`,
        };
      }
      daemon.autoWake(toOrg);
      return { ok: true, receipt: `queued for ${toOrg}:${toRole} (org waking)` };
    }
    return { ok: false, error: `org "${toOrg}" not hosted here` };
  }
  // M2: an endpoint role has no mailbox — POST to its endpoint instead.
  const endpointRole = findEndpointRole(org.def, toRole);
  if (endpointRole) {
    const from = fromQualified.startsWith(`${toOrg}:`)
      ? fromQualified.slice(toOrg.length + 1)
      : fromQualified;
    const receipt = await deliverToEndpoint(daemon, {
      orgName: toOrg,
      org,
      role: endpointRole,
      from,
      subject,
      body,
      messageId,
      eventTo: `${toOrg}:${toRole}`,
    });
    return receipt.startsWith('ERROR:')
      ? { ok: false, error: receipt.slice('ERROR: '.length) }
      : { ok: true, receipt };
  }
  // Lazy-spawn pending roles on cross-process delivery (matches deliver/answerQuestion)
  // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
  const spawning = daemon.spawning.get(toOrg) ?? new Set<string>();
  daemon.spawning.set(toOrg, spawning);
  if (!org.agents.has(toRole) && org.pendingRoles?.has(toRole) && !spawning.has(toRole)) {
    const role = org.pendingRoles.get(toRole)!;
    org.pendingRoles.delete(toRole);
    markDeferredSpawn(toOrg, toRole); // BUG 1 FIX: mark in-flight before any await
    spawning.add(toRole); // Mark as spawning before async work
    // Bug 4: same max_concurrent_agents gate as deliver() — checked before the
    // host-resource-pressure gate below (prevents bypass in cross-process delivery).
    const concurrencyLimit = org.def.run_config.max_concurrent_agents;
    if (concurrencyLimit != null && activeRoleCount(org) >= concurrencyLimit) {
      spawning.delete(toRole);
      org.bus.emit({
        type: 'audit',
        from: toRole,
        reason: 'concurrency-limit',
        msg: `cross-process lazy spawn deferred: org is at its max_concurrent_agents ceiling (${concurrencyLimit})`,
      });
      const queued = queueMessage(daemon.root, toOrg, {
        fromQualified,
        toRole,
        subject,
        body,
        ts: Date.now(),
        messageId,
      });
      if (!queued) {
        return {
          ok: false,
          error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)`,
        };
      }
      daemon.scheduleConcurrencyDeferredSpawn(toOrg, org, role, org.spawnRole!);
      return {
        ok: true,
        receipt: `queued for ${toOrg}:${toRole} (role starting — waiting for a concurrency slot)`,
      };
    }
    // Resource gate check before spawning (prevents bypass in cross-process delivery)
    const check = checkResources();
    if (!check.ok) {
      spawning.delete(toRole); // Clear spawning flag after check
      org.bus.emit({
        type: 'audit',
        from: toRole,
        reason: 'resource-pressure',
        msg: `cross-process lazy spawn deferred: ${check.reason}`,
      });
      // B4 FIX: Queue the triggering message FIRST, then schedule spawn only if queue succeeds.
      // This matches the pattern in deliver() and prevents message loss if queue fails.
      const queued = queueMessage(daemon.root, toOrg, {
        fromQualified,
        toRole,
        subject,
        body,
        ts: Date.now(),
        messageId,
      });
      if (!queued) {
        return {
          ok: false,
          error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)`,
        };
      }
      daemon.scheduleDeferredSpawn(toOrg, org, role, org.spawnRole!);
      return {
        ok: true,
        receipt: `queued for ${toOrg}:${toRole} (role starting — waiting for resources)`,
      };
    }
    org.spawnRole?.(role);
    clearDeferredSpawn(toOrg, toRole); // BUG 1 FIX: spawn completed — no longer in-flight
    spawning.delete(toRole); // Clear spawning flag after spawn completes
    org.bus.emit({
      type: 'status',
      from: toRole,
      msg: `lazy-spawned on remote delivery from ${fromQualified}`,
    });
  }
  // BUG 1 FIX: same in-flight check as deliver() — a second cross-process
  // message arriving while the role's spawn is deferred under resource
  // pressure must queue, not report "role not found".
  if (isDeferredSpawn(org, toOrg, toRole)) {
    const queued = queueMessage(daemon.root, toOrg, {
      fromQualified,
      toRole,
      subject,
      body,
      ts: Date.now(),
      messageId,
    });
    if (!queued) {
      return {
        ok: false,
        error: `could not queue message for ${toOrg}:${toRole} (disk full or permissions)`,
      };
    }
    const slot = org.deferredSpawns?.get(toRole)?.gate === 'concurrency';
    return {
      ok: true,
      receipt: `queued for ${toOrg}:${toRole} (role starting — waiting for ${slot ? 'a concurrency slot' : 'resources'})`,
    };
  }
  const agent = org.agents.get(toRole);
  if (!agent) return { ok: false, error: `role "${toRole}" not found in org "${toOrg}"` };
  if (agent.status === 'crashed')
    return {
      ok: false,
      error: `role "${toRole}" in org "${toOrg}" crashed and will not recover this run`,
    };
  if (agent.mailbox.isClosed)
    return { ok: false, error: `role "${toRole}" in org "${toOrg}" is shutting down` };
  const messageEvent = org.bus.emit({
    type: 'xorg',
    from: fromQualified,
    to: `${toOrg}:${toRole}`,
    subject,
    msg: body,
    data: { messageId },
  });
  agent.lastMessageId = messageEvent.id; // Track last message ID for response threading
  const pushed = await pushMessage(
    daemon,
    toOrg,
    org,
    toRole,
    fromQualified,
    subject,
    body,
    messageEvent.id,
  );
  if (!pushed)
    return { ok: false, error: `message to ${toOrg}:${toRole} blocked by security fence` };
  return { ok: true, receipt: `delivered to ${toOrg}:${toRole} (remote)` };
}
