// packages/@monomind/cli/src/orgrt/cross-org-deliver.ts
// Split out of cross-org.ts (file-size sweep) — the local-process deliver() entry point.
import { checkResources, waitForCapacity } from '../utils/resource-governor.js';
import { clearDeferredSpawn, isDeferredSpawn, markDeferredSpawn } from './cross-org-deferred.js';
import { pushMessage, resolveAddress } from './cross-org-mail.js';
import { deliverRemote } from './cross-org-remote.js';
import { activeRoleCount, type OrgDaemon } from './daemon.js';
import { deliverToEndpoint, findEndpointRole } from './endpoint-roles.js';
import { newMessageId, queueMessage } from './inbox.js';

/** Route a message. to = "role" (same org) or "org:role" (cross-org). Returns a receipt string. */
export async function deliver(
  daemon: OrgDaemon,
  fromOrg: string,
  fromRole: string,
  to: string,
  subject: string,
  body: string,
  opts: { messageId?: string } = {},
): Promise<string> {
  // M3: one id per logical message, stamped on every bus copy and queue entry.
  const messageId = opts.messageId ?? newMessageId();
  const {
    cross,
    orgName: targetOrgName,
    role: targetRole,
    qualified: toQualified,
  } = resolveAddress(fromOrg, to);
  const targetOrg = daemon.orgs.get(targetOrgName);
  const src = daemon.orgs.get(fromOrg);
  // A message queued for a role that has no session yet leaves no 'message' event (it is delivered at the spawn);
  // the lead watch needs to know it was sent, so say so once it is safely queued (lead-watch.ts).
  const noteQueued = (): void => {
    if (cross) return;
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to: targetRole,
      subject,
      msg: body.slice(0, 500),
      reason: 'message-queued',
      data: { messageId },
    });
  };
  // ADR-O001 D6: an artifact-only reviewer takes runtime-built packets only.
  // Another agent's mail is exactly the doer's framing D6 keeps out, so it is
  // refused with the way to get a review instead. The human is not an agent.
  const reviewerRole = targetOrg?.def.roles.find((r) => r.id === targetRole);
  if (reviewerRole?.review_input === 'artifact-only' && (cross || fromRole !== 'human')) {
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to: toQualified,
      reason: 'review-mail-refused',
      msg: `mail to artifact-only reviewer ${toQualified} refused: ${subject}`,
    });
    return `REFUSED: "${toQualified}" is an artifact-only reviewer and does not take messages from agents. Request a review with org_review(taskId, "${targetRole}") — it is built from the task, its evidence and the diff.`;
  }
  // M2: an endpoint role has no mailbox — POST to its endpoint instead.
  const endpointRole = targetOrg ? findEndpointRole(targetOrg.def, targetRole) : undefined;
  if (targetOrg && endpointRole) {
    return deliverToEndpoint(daemon, {
      orgName: targetOrgName,
      org: targetOrg,
      role: endpointRole,
      from: cross ? `${fromOrg}:${fromRole}` : fromRole,
      subject,
      body,
      messageId,
      src,
      eventTo: toQualified,
    });
  }
  // Lazy spawn: if the role is pending (not yet spawned), spawn it now.
  // ATOMIC GUARD: Check spawning Set to prevent duplicate spawns from concurrent messages
  const spawning = daemon.spawning.get(targetOrgName) ?? new Set<string>();
  daemon.spawning.set(targetOrgName, spawning);
  if (
    targetOrg &&
    !targetOrg.agents.has(targetRole) &&
    targetOrg.pendingRoles?.has(targetRole) &&
    !spawning.has(targetRole)
  ) {
    const role = targetOrg.pendingRoles.get(targetRole)!;
    targetOrg.pendingRoles.delete(targetRole);
    markDeferredSpawn(targetOrgName, targetRole); // BUG 1 FIX: mark in-flight before any await
    spawning.add(targetRole); // Mark as spawning before async work
    // Bug 4: run_config.max_concurrent_agents caps how many roles can run at
    // once — defer the same way the host-resource-pressure check below defers,
    // instead of spawning past the ceiling unconditionally.
    const concurrencyLimit = targetOrg.def.run_config.max_concurrent_agents;
    if (concurrencyLimit != null && activeRoleCount(targetOrg) >= concurrencyLimit) {
      spawning.delete(targetRole);
      targetOrg.bus.emit({
        type: 'audit',
        from: targetRole,
        reason: 'concurrency-limit',
        msg: `deferring lazy spawn of "${targetRole}": org is at its max_concurrent_agents ceiling (${concurrencyLimit})`,
      });
      const queued = queueMessage(daemon.root, targetOrgName, {
        fromQualified: cross ? `${fromOrg}:${fromRole}` : fromRole,
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
          to: toQualified,
          msg: `queue failed: ${subject}`,
          reason: 'queue-failed',
        });
        return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
      }
      noteQueued();
      daemon.scheduleConcurrencyDeferredSpawn(targetOrgName, targetOrg, role, targetOrg.spawnRole!);
      return `queued for ${toQualified} (role starting — waiting for a concurrency slot)`;
    }
    const check = checkResources();
    if (!check.ok) {
      const waited = await waitForCapacity(60_000);
      spawning.delete(targetRole); // Clear spawning flag after check
      if (!waited.ok) {
        targetOrg.bus.emit({
          type: 'audit',
          from: targetRole,
          reason: 'resource-skip',
          msg: `deferring lazy spawn of "${targetRole}": ${waited.reason}`,
        });
        // Queue the triggering message so it survives the deferred spawn — without
        // this the sender got "queued" but the message was silently lost.
        // B5 FIX: Queue FIRST, then schedule spawn only if queue succeeds.
        // If queueing fails, we return the error without modifying spawn state.
        const queued = queueMessage(daemon.root, targetOrgName, {
          fromQualified: cross ? `${fromOrg}:${fromRole}` : fromRole,
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
            to: toQualified,
            msg: `queue failed: ${subject}`,
            reason: 'queue-failed',
          });
          return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
        }
        noteQueued();
        daemon.scheduleDeferredSpawn(targetOrgName, targetOrg, role, targetOrg.spawnRole!);
        return `queued for ${toQualified} (role starting — waiting for resources)`;
      }
    }
    targetOrg.spawnRole?.(role);
    clearDeferredSpawn(targetOrgName, targetRole); // BUG 1 FIX: spawn completed — no longer in-flight
    spawning.delete(targetRole); // Clear spawning flag after spawn completes
    targetOrg.bus.emit({
      type: 'status',
      from: targetRole,
      msg: `lazy-spawned on first message from ${fromRole}`,
    });
  }
  if (!targetOrg?.agents.has(targetRole)) {
    if (cross && daemon.opts.crossProcess)
      return deliverRemote(
        daemon,
        fromOrg,
        fromRole,
        targetOrgName,
        targetRole,
        toQualified,
        subject,
        body,
        src,
        messageId,
      );
    // Queue + auto-wake: if the org definition exists locally but isn't running, spool the message and start it
    if (cross && daemon.hasOrgDef(targetOrgName)) {
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
          to: toQualified,
          msg: `queue failed: ${subject}`,
          reason: 'queue-failed',
        });
        return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
      }
      src?.bus.emit({
        type: 'xorg',
        from: `${fromOrg}:${fromRole}`,
        to: toQualified,
        subject,
        msg: body,
        data: { queued: true, messageId },
      });
      daemon.autoWake(targetOrgName);
      return `queued for ${toQualified} (org starting)`;
    }
    // BUG 1 FIX: the role's lazy spawn is genuinely in flight (deferred under
    // resource pressure, pendingRoles already consumed) — queue this message
    // like the first one that triggered the spawn, instead of falling
    // through to "unknown recipient" and silently dropping it.
    if (targetOrg && isDeferredSpawn(targetOrg, targetOrgName, targetRole)) {
      const queued = queueMessage(daemon.root, targetOrgName, {
        fromQualified: cross ? `${fromOrg}:${fromRole}` : fromRole,
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
          to: toQualified,
          msg: `queue failed: ${subject}`,
          reason: 'queue-failed',
        });
        return `ERROR: could not queue message for ${toQualified} (disk full or permissions)`;
      }
      noteQueued();
      const slot = targetOrg.deferredSpawns?.get(targetRole)?.gate === 'concurrency';
      return `queued for ${toQualified} (role starting — waiting for ${slot ? 'a concurrency slot' : 'resources'})`;
    }
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to: toQualified,
      msg: `undeliverable: ${subject}`,
      reason: 'unknown recipient',
    });
    return `ERROR: unknown recipient "${toQualified}" (known: ${[...(targetOrg?.agents.keys() ?? daemon.orgs.keys())].join(', ')})`;
  }
  const targetAgent = targetOrg.agents.get(targetRole)!;
  if (targetAgent.status === 'crashed') {
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to: toQualified,
      msg: `undeliverable: ${subject}`,
      reason: 'recipient crashed (retry budget exhausted)',
    });
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
      src?.bus.emit({
        type: 'audit',
        from: fromRole,
        to: toQualified,
        msg: `undeliverable: ${subject}`,
        reason: 'target mailbox closed (org shutting down)',
      });
      return `ERROR: recipient "${toQualified}" is shutting down — message not delivered`;
    }
    const q = queueMessage(daemon.root, targetOrgName, {
      fromQualified: `${fromOrg}:${fromRole}`,
      toRole: targetRole,
      subject,
      body,
      ts: Date.now(),
      messageId,
    });
    src?.bus.emit({
      type: 'audit',
      from: fromRole,
      to: toQualified,
      msg: `recipient session closed — queued to inbox: ${subject}`,
      data: { queued: q },
    });
    return `queued to inbox for ${toQualified} (recipient session closed; will be delivered on restart)`;
  }
  // Track message chain: link this message to the target's last message (the one being responded to)
  const targetAgentSrc = targetOrg === src ? src?.agents.get(targetRole) : undefined;
  const parentId = targetAgentSrc?.lastMessageId;
  const evt = {
    from: cross ? `${fromOrg}:${fromRole}` : fromRole,
    to: toQualified,
    subject,
    msg: body,
    parentId,
    data: { messageId },
  };
  const emitted = src?.bus.emit({ type: cross ? 'xorg' : 'message', ...evt });
  if (cross && targetOrg !== src) targetOrg.bus.emit({ type: 'xorg', ...evt });
  // Store message ID for the target (so responses can link to it)
  if (targetAgentSrc && emitted) targetAgentSrc.lastMessageId = emitted.id;
  // Also track the source agent's last sent message for cross-org visibility
  const srcAgent = src?.agents.get(fromRole);
  if (srcAgent && emitted) srcAgent.lastMessageId = emitted.id;
  const pushed = await pushMessage(
    daemon,
    targetOrgName,
    targetOrg,
    targetRole,
    evt.from,
    subject,
    body,
    emitted?.id ?? `mail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  if (!pushed) return `ERROR: message to ${toQualified} blocked by security fence`;
  // ORG-1: a cross-org deliver() is a "handoff" — work/context crossing an org
  // boundary — a natural decision point. Recorded here (not for every intra-org
  // org_send, which would be too noisy) so `org decisions` shows real traces.
  if (cross) {
    daemon.recordDecision(fromOrg, fromRole, {
      type: 'handoff',
      kind: 'cross-org-handoff',
      context: `deliver to ${toQualified}: ${subject}`,
      reasoning: `cross-org handoff from ${fromOrg}:${fromRole} to ${toQualified}`,
      outcome: 'delivered',
    });
  }
  return `delivered to ${toQualified}`;
}
