// packages/@monomind/cli/src/orgrt/endpoint-roles.ts
/**
 * Endpoint roles (M2, capability `org-endpoint-roles`).
 *
 * A role with `kind: "endpoint"` is not an agent: it has no session, mailbox,
 * policy engine, slot or budget. A message addressed to it is POSTed to
 * `endpoint.url` (an automation — e.g. a mono-agent workflow), which replies
 * later through `/api/xdeliver` as `<org>:<role>`.
 *
 *   POST <endpoint.url>
 *   content-type: application/json
 *   authorization: Bearer <credential_file contents>   (only if credential_file)
 *   {"orgName","run","from","to","subject","body","messageId"}
 *
 * 2xx = delivered. Anything else queues the message (`inbox.jsonl`,
 * `endpoint: true`) and retries after 1 s, 5 s and 15 s; after the third
 * failure an `endpoint-unreachable` audit event is emitted and the message
 * stays queued. While the org runs, queued endpoint entries are re-attempted
 * every 60 s, and `startOrg`'s drain delivers them too.
 */
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import type { OrgDaemon, RunningOrg } from './daemon.js';
import { newMessageId, peekInbox, type QueuedMessage, queueMessage, takeQueued } from './inbox.js';
import type { OrgDef, OrgRole } from './types.js';

export const ENDPOINT_POST_TIMEOUT_MS = 15_000;
export const DEFAULT_ENDPOINT_WAIT_MS = 600_000;
export const ENDPOINT_RETRY_MS = [1_000, 5_000, 15_000];
export const ENDPOINT_PERIODIC_RETRY_MS = 60_000;

/** Keys an endpoint role may not carry (it is not an agent). */
export const ENDPOINT_FORBIDDEN_KEYS = [
  'policy',
  'runtime',
  'adapter_config',
  'budget_tokens',
  'budget_usd',
  'tool_providers',
] as const;

export function isEndpointRole(role: unknown): boolean {
  return (role as { kind?: unknown } | undefined)?.kind === 'endpoint';
}

/** Roles that get sessions — everything except endpoint roles. */
export function agentRoles<R>(roles: R[]): R[] {
  return roles.filter((r) => !isEndpointRole(r));
}

export function findEndpointRole(
  def: Pick<OrgDef, 'roles'> | undefined,
  roleId: string,
): OrgRole | undefined {
  const role = def?.roles.find((r) => r.id === roleId);
  return role && isEndpointRole(role) ? role : undefined;
}

/** `org validate` rules for endpoint roles. */
export function endpointStructureErrors(def: Pick<OrgDef, 'roles'>): string[] {
  const errors: string[] = [];
  for (const r of def.roles) {
    if (!isEndpointRole(r)) continue;
    const rec = r as Record<string, unknown>;
    if (r.reports_to === null) errors.push(`endpoint role "${r.id}" may not be the root role`);
    if (!r.endpoint?.url) errors.push(`endpoint role "${r.id}" needs endpoint.url`);
    for (const k of ENDPOINT_FORBIDDEN_KEYS)
      if (rec[k] !== undefined) errors.push(`endpoint role "${r.id}" may not have "${k}"`);
    const cred = r.endpoint?.credential_file;
    if (cred !== undefined && !isAbsolute(cred))
      errors.push(`endpoint role "${r.id}": endpoint.credential_file must be an absolute path`);
  }
  return errors;
}

/** Boss briefing: one line per endpoint role. */
export function endpointBriefingLines(def: Pick<OrgDef, 'roles'> | undefined): string[] {
  if (!def) return [];
  return def.roles.filter(isEndpointRole).map((r) => {
    const hint = r.endpoint?.input_hint?.trim();
    return `- ${r.id} (${r.title || r.type}) is an automation, not an agent. Message it with org_send; it replies with its result.${hint ? ` ${hint}` : ''}`;
  });
}

// ── Credential + POST ────────────────────────────────────────────────────

export type EndpointAttempt =
  | { ok: true; status: number }
  | { ok: false; error: string; insecure?: boolean };

/** Read `credential_file` at delivery time (rotation needs no restart). It
 *  must be absolute, mode 0600 and owned by the daemon's user. */
export function readEndpointCredential(
  file: string | undefined,
): { ok: true; token?: string } | { ok: false; error: string; insecure: boolean } {
  if (!file) return { ok: true };
  if (!isAbsolute(file))
    return { ok: false, insecure: true, error: `credential_file ${file} is not an absolute path` };
  let st: ReturnType<typeof statSync>;
  try {
    st = statSync(file);
  } catch (err) {
    return {
      ok: false,
      insecure: false,
      error: `credential_file unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (process.platform !== 'win32') {
    const mode = Number(st.mode) & 0o777;
    if (mode !== 0o600)
      return {
        ok: false,
        insecure: true,
        error: `credential_file ${file} has mode ${mode.toString(8).padStart(4, '0')} (must be 0600)`,
      };
    const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
    if (uid !== undefined && Number(st.uid) !== uid)
      return {
        ok: false,
        insecure: true,
        error: `credential_file ${file} is owned by uid ${st.uid}, not the daemon user (${uid})`,
      };
  }
  try {
    const value = readFileSync(file, 'utf8').trim();
    return { ok: true, token: value };
  } catch (err) {
    return {
      ok: false,
      insecure: false,
      error: `credential_file unreadable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export interface EndpointPayload {
  orgName: string;
  run: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  messageId: string;
}

export async function postToEndpoint(
  role: OrgRole,
  payload: EndpointPayload,
  timeoutMs = ENDPOINT_POST_TIMEOUT_MS,
): Promise<EndpointAttempt> {
  const url = role.endpoint?.url;
  if (!url) return { ok: false, error: `role "${role.id}" has no endpoint.url` };
  const cred = readEndpointCredential(role.endpoint?.credential_file);
  if (!cred.ok) return cred;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(cred.token ? { authorization: `Bearer ${cred.token}` } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Drain the body so the connection is released.
    await res.text().catch(() => '');
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── Watchdog hold ────────────────────────────────────────────────────────

export interface EndpointWait {
  role: string;
  messageId: string;
  until: number;
}

export function recordEndpointWait(org: RunningOrg, role: OrgRole, messageId: string): void {
  if (!org.endpointWaits) org.endpointWaits = [];
  org.endpointWaits.push({
    role: role.id,
    messageId,
    until: Date.now() + (role.endpoint?.timeout_ms ?? DEFAULT_ENDPOINT_WAIT_MS),
  });
}

/** A message from `<org>:<endpointRole>` (or `<endpointRole>`) clears that
 *  role's oldest wait. */
export function clearEndpointWait(org: RunningOrg, orgName: string, from: string): void {
  const waits = org.endpointWaits;
  if (!waits?.length) return;
  const role = from.startsWith(`${orgName}:`) ? from.slice(orgName.length + 1) : from;
  const idx = waits.findIndex((w) => w.role === role);
  if (idx !== -1) waits.splice(idx, 1);
}

/** True while any endpoint wait is unexpired (expired ones are pruned). */
export function hasActiveEndpointWait(org: RunningOrg, now = Date.now()): boolean {
  if (!org.endpointWaits?.length) return false;
  org.endpointWaits = org.endpointWaits.filter((w) => w.until > now);
  return org.endpointWaits.length > 0;
}

// ── Delivery, queue, retry ───────────────────────────────────────────────

interface RetryState {
  timers: Set<ReturnType<typeof setTimeout>>;
  /** messageIds whose 1 s / 5 s / 15 s schedule is still running. */
  scheduled: Set<string>;
  /** messageIds already reported as insecure (one audit per message). */
  insecureReported: Set<string>;
  periodic?: ReturnType<typeof setInterval>;
  sweeping?: boolean;
}

const retryStates = new WeakMap<OrgDaemon, Map<string, RetryState>>();

function stateFor(daemon: OrgDaemon, org: string): RetryState {
  let byOrg = retryStates.get(daemon);
  if (!byOrg) {
    byOrg = new Map();
    retryStates.set(daemon, byOrg);
  }
  let st = byOrg.get(org);
  if (!st) {
    st = { timers: new Set(), scheduled: new Set(), insecureReported: new Set() };
    byOrg.set(org, st);
  }
  return st;
}

function toQualified(orgName: string, roleId: string): string {
  return `${orgName}:${roleId}`;
}

/** One POST attempt; on success emits the delivery event(s) and records the
 *  watchdog wait; on an insecure credential emits the audit event. */
async function attempt(
  daemon: OrgDaemon,
  orgName: string,
  org: RunningOrg,
  role: OrgRole,
  msg: { from: string; subject: string; body: string; messageId: string },
  emitTo: RunningOrg[],
  eventTo: string,
): Promise<EndpointAttempt> {
  const result = await postToEndpoint(
    role,
    {
      orgName,
      run: org.run,
      from: msg.from,
      to: toQualified(orgName, role.id),
      subject: msg.subject,
      body: msg.body,
      messageId: msg.messageId,
    },
    daemon.opts.endpointPostTimeoutMs,
  );
  if (result.ok) {
    const cross = msg.from.includes(':') && !msg.from.startsWith(`${orgName}:`);
    for (const target of emitTo) {
      target.bus.emit({
        type: cross ? 'xorg' : 'message',
        from: msg.from,
        to: eventTo,
        subject: msg.subject,
        msg: msg.body,
        data: { messageId: msg.messageId, endpoint: true },
      });
    }
    recordEndpointWait(org, role, msg.messageId);
    return result;
  }
  if (result.insecure) {
    const st = stateFor(daemon, orgName);
    if (!st.insecureReported.has(msg.messageId)) {
      st.insecureReported.add(msg.messageId);
      org.bus.emit({
        type: 'audit',
        from: role.id,
        reason: 'endpoint-credential-insecure',
        msg: `endpoint role "${role.id}": ${result.error} — not delivering, message queued`,
        data: { role: role.id, messageId: msg.messageId, error: result.error },
      });
    }
  }
  return result;
}

/** deliver()/receiveRemote() leg for a target that is an endpoint role. */
export async function deliverToEndpoint(
  daemon: OrgDaemon,
  args: {
    orgName: string;
    org: RunningOrg;
    role: OrgRole;
    /** Sender as the payload names it: bare role (same org) or `org:role`. */
    from: string;
    subject: string;
    body: string;
    messageId: string;
    /** Extra bus to copy the delivery event to (a different sender org). */
    src?: RunningOrg;
    /** `to` on the emitted event (deliver()'s display form). */
    eventTo?: string;
  },
): Promise<string> {
  const { orgName, org, role, messageId } = args;
  const to = toQualified(orgName, role.id);
  const emitTo = args.src && args.src !== org ? [args.src, org] : [org];
  const result = await attempt(
    daemon,
    orgName,
    org,
    role,
    { from: args.from, subject: args.subject, body: args.body, messageId },
    emitTo,
    args.eventTo ?? to,
  );
  if (result.ok) return `delivered to ${to} (endpoint)`;

  const queued = queueMessage(daemon.root, orgName, {
    fromQualified: args.from,
    toRole: role.id,
    subject: args.subject,
    body: args.body,
    ts: Date.now(),
    messageId,
    endpoint: true,
  });
  if (!queued) return `ERROR: could not queue message for ${to} (disk full or permissions)`;
  if (result.insecure)
    return `queued for ${to} (endpoint credential insecure: ${result.error} — not delivered)`;
  scheduleEndpointRetries(daemon, orgName, messageId, role.id);
  return `queued for ${to} (endpoint unreachable: ${result.error} — retrying)`;
}

/** Take matching queued endpoint entries and POST them; failures are
 *  re-queued. Returns the last error per messageId that stayed queued. */
export async function retryQueuedEndpoints(
  daemon: OrgDaemon,
  orgName: string,
  predicate: (m: QueuedMessage) => boolean = () => true,
): Promise<{ delivered: string[]; failed: Map<string, string> }> {
  const delivered: string[] = [];
  const failed = new Map<string, string>();
  const org = daemon.orgs.get(orgName);
  if (!org) return { delivered, failed };
  const isTarget = (m: QueuedMessage): boolean =>
    !!findEndpointRole(org.def, m.toRole) && predicate(m);
  if (!peekInbox(daemon.root, orgName).some(isTarget)) return { delivered, failed };
  const taken = takeQueued(daemon.root, orgName, isTarget);
  for (const m of taken) {
    const role = findEndpointRole(org.def, m.toRole);
    const messageId = m.messageId ?? newMessageId();
    const result = role
      ? await attempt(
          daemon,
          orgName,
          org,
          role,
          { from: m.fromQualified, subject: m.subject, body: m.body, messageId },
          [org],
          toQualified(orgName, m.toRole),
        )
      : ({ ok: false, error: 'role is no longer an endpoint role' } as EndpointAttempt);
    if (result.ok) {
      delivered.push(messageId);
    } else {
      failed.set(messageId, result.error);
      queueMessage(daemon.root, orgName, { ...m, messageId, endpoint: true });
    }
  }
  return { delivered, failed };
}

/** 1 s / 5 s / 15 s retries for one queued message; after the last failure
 *  emit `endpoint-unreachable` and leave it queued for the periodic sweep. */
export function scheduleEndpointRetries(
  daemon: OrgDaemon,
  orgName: string,
  messageId: string,
  roleId: string,
): void {
  const st = stateFor(daemon, orgName);
  if (st.scheduled.has(messageId)) return;
  st.scheduled.add(messageId);
  const delays = daemon.opts.endpointRetryMs ?? ENDPOINT_RETRY_MS;
  const step = (i: number): void => {
    if (i >= delays.length) return;
    const t = setTimeout(async () => {
      st.timers.delete(t);
      if (!daemon.orgs.has(orgName)) {
        st.scheduled.delete(messageId);
        return;
      }
      const { delivered, failed } = await retryQueuedEndpoints(
        daemon,
        orgName,
        (m) => m.messageId === messageId,
      );
      if (delivered.includes(messageId) || !failed.has(messageId)) {
        // Delivered, or no longer queued (another path took it).
        st.scheduled.delete(messageId);
        return;
      }
      if (i === delays.length - 1) {
        st.scheduled.delete(messageId);
        const error = failed.get(messageId);
        daemon.orgs.get(orgName)?.bus.emit({
          type: 'audit',
          from: roleId,
          reason: 'endpoint-unreachable',
          msg: `endpoint role "${roleId}" unreachable after ${delays.length} retries (${error}) — message stays queued`,
          data: { role: roleId, messageId, error },
        });
        return;
      }
      step(i + 1);
    }, delays[i]);
    t.unref?.();
    st.timers.add(t);
  };
  step(0);
}

/** Periodic (60 s) re-attempt of queued endpoint entries while `org` runs.
 *  Entries still on their 1/5/15 s schedule are skipped. */
export function startEndpointRetryLoop(daemon: OrgDaemon, orgName: string): void {
  const st = stateFor(daemon, orgName);
  if (st.periodic) clearInterval(st.periodic);
  st.periodic = setInterval(async () => {
    if (st.sweeping || !daemon.orgs.has(orgName)) return;
    st.sweeping = true;
    try {
      await retryQueuedEndpoints(
        daemon,
        orgName,
        (m) => !m.messageId || !st.scheduled.has(m.messageId),
      );
    } catch {
      /* best-effort — next sweep retries */
    } finally {
      st.sweeping = false;
    }
  }, daemon.opts.endpointPeriodicRetryMs ?? ENDPOINT_PERIODIC_RETRY_MS);
  st.periodic.unref?.();
}

/** Stop every retry timer for `org` (stopOrg). Queued entries stay queued. */
export function stopEndpointRetries(daemon: OrgDaemon, orgName: string): void {
  const byOrg = retryStates.get(daemon);
  const st = byOrg?.get(orgName);
  if (!st) return;
  if (st.periodic) clearInterval(st.periodic);
  for (const t of st.timers) clearTimeout(t);
  byOrg?.delete(orgName);
}
