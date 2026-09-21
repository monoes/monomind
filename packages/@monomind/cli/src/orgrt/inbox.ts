// packages/@monomind/cli/src/orgrt/inbox.ts
// Persistent message queue for offline orgs. Messages that can't be delivered
// (target org not running) are spooled here and drained when the org starts.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { defaultOperatorDir } from './broker.js';
import { ORG_DIR } from './types.js';

/** M3: id of one logical message — `msg-<ms>-<8 hex>` — generated once at the
 *  message's origin and carried on every bus copy and queue entry. */
export function newMessageId(): string {
  return `msg-${Date.now()}-${randomBytes(4).toString('hex')}`;
}

export interface QueuedMessage {
  fromQualified: string; // "orgA:role"
  toRole: string;
  subject: string;
  body: string;
  ts: number;
  /** M3: origin message id, re-used when the queue is drained. */
  messageId?: string;
  /** M2: queued for an endpoint role (retried by POST, never drained into a mailbox). */
  endpoint?: boolean;
  /** Structured handoff context (rich metadata for role transitions) */
  context?: {
    summary?: string; // Brief one-line status
    nextAction?: string; // What the receiver should do next
    filesChanged?: string[]; // Files touched in this work
    relatedIssues?: string[]; // Related issue numbers
    metadata?: Record<string, unknown>; // Additional custom fields
  };
}

/** The inbox sits in the org's own directory, which its roles can write, and
 *  a drained message is delivered with the sender it names — `human` among
 *  them. So every entry is signed with a key kept in the operator-credential
 *  directory, which no role can read (file-roots.ts), and an entry that does
 *  not verify is delivered as UNVERIFIED rather than as its claimed sender.
 *  Every legitimate writer (daemon, `org` CLI, dashboard) runs outside the
 *  roles and goes through queueMessage. */
function inboxKey(create: boolean): Buffer | null {
  const dir = defaultOperatorDir();
  const file = join(dir, 'inbox.key');
  try {
    return readFileSync(file);
  } catch {
    if (!create) return null;
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32), { mode: 0o600, flag: 'wx' });
  } catch {
    /* another writer created it first — read theirs */
  }
  try {
    return readFileSync(file);
  } catch {
    return null;
  }
}

function signatureOf(key: Buffer, msg: QueuedMessage): string {
  return createHmac('sha256', key)
    .update(
      JSON.stringify([msg.fromQualified, msg.toRole, msg.subject, msg.body, msg.ts, msg.messageId ?? null]),
    )
    .digest('hex');
}

/** A read entry, stripped of its signature: as written when it verifies,
 *  otherwise with its sender and subject marked unverified. */
function verified(msg: QueuedMessage & { sig?: unknown }): QueuedMessage {
  const { sig, ...rest } = msg;
  const key = typeof sig === 'string' ? inboxKey(false) : null;
  if (key) {
    const want = Buffer.from(signatureOf(key, rest));
    const got = Buffer.from(sig as string);
    if (got.length === want.length && timingSafeEqual(got, want)) return rest;
  }
  if (rest.fromQualified.startsWith('unverified(')) return rest;
  return {
    ...rest,
    fromQualified: `unverified(${rest.fromQualified})`,
    subject: `[UNVERIFIED: found in the inbox file, not queued by the org daemon, CLI or dashboard] ${rest.subject}`,
  };
}

function inboxPath(root: string, orgName: string): string {
  return join(root, ORG_DIR, orgName, 'inbox.jsonl');
}

export function queueMessage(root: string, orgName: string, msg: QueuedMessage): boolean {
  try {
    const dir = join(root, ORG_DIR, orgName);
    mkdirSync(dir, { recursive: true });
    const { sig: _drop, ...clean } = msg as QueuedMessage & { sig?: unknown };
    const key = inboxKey(true);
    const line = key ? { ...clean, sig: signatureOf(key, clean) } : clean;
    appendFileSync(inboxPath(root, orgName), `${JSON.stringify(line)}\n`);
    return true;
  } catch (err) {
    // Log error but don't throw — caller needs to know delivery failed
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error(
        `[inbox] queueMessage failed for org "${orgName}":`,
        err instanceof Error ? err.message : err,
      );
    return false;
  }
}

function parseLines(raw: string): QueuedMessage[] {
  const msgs: QueuedMessage[] = [];
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    try {
      msgs.push(verified(JSON.parse(line)));
    } catch {
      /* skip corrupt lines */
    }
  }
  return msgs;
}

export function drainInbox(root: string, orgName: string): QueuedMessage[] {
  const path = inboxPath(root, orgName);
  const draining = `${path}.draining`;
  const msgs: QueuedMessage[] = [];

  // Recover a .draining file left behind by a mid-drain crash. Without this the
  // rename below would overwrite it and lose exactly the messages the rename-then-read
  // scheme exists to protect.
  if (existsSync(draining)) {
    try {
      msgs.push(...parseLines(readFileSync(draining, 'utf8')));
      unlinkSync(draining);
    } catch (e) {
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
        console.error('[inbox] drainInbox recovery of .draining failed:', e);
      return msgs; // don't rename over a file we couldn't consume
    }
  }

  if (!existsSync(path)) return msgs;
  // Rename-then-read: if the process crashes after rename but before we finish
  // reading, the .draining file survives (and is recovered above on the next
  // drain). A plain read-then-truncate would lose messages on a mid-drain crash.
  try {
    renameSync(path, draining);
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[inbox] drainInbox rename failed:', e);
    return msgs;
  }
  let raw = '';
  try {
    raw = readFileSync(draining, 'utf8');
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[inbox] drainInbox read failed:', e);
    return msgs;
  }
  msgs.push(...parseLines(raw));
  // Unlink the drained snapshot rather than truncating it and renaming it back over
  // `path`. A sender that appended between the rename above and this point created a
  // fresh `path` (queueMessage mkdir+appends), and renaming the emptied snapshot back
  // would clobber it — destroying messages whose sender already got a "queued" receipt.
  // Those messages now simply stay in `path` and are picked up by the next drain.
  try {
    unlinkSync(draining);
  } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG)
      console.error('[inbox] drainInbox unlink failed:', e);
  }
  return msgs;
}

/** Non-destructive read of the queue (pending file plus an interrupted drain). */
export function peekInbox(root: string, orgName: string): QueuedMessage[] {
  const path = inboxPath(root, orgName);
  const msgs: QueuedMessage[] = [];
  for (const f of [`${path}.draining`, path]) {
    try {
      if (existsSync(f)) msgs.push(...parseLines(readFileSync(f, 'utf8')));
    } catch {
      /* unreadable — treat as empty */
    }
  }
  return msgs;
}

/** Remove and return the queued messages matching `predicate`; every other
 *  message is put back. M2 uses it to retry endpoint entries while leaving
 *  other queued messages in place.
 *
 *  The snapshot is renamed to `.draining` (which drainInbox recovers after a
 *  crash) and only unlinked AFTER the untouched messages were appended back,
 *  so a crash can at worst duplicate a message, never lose one — and a
 *  concurrent peekInbox never sees the untouched messages disappear. */
export function takeQueued(
  root: string,
  orgName: string,
  predicate: (m: QueuedMessage) => boolean,
): QueuedMessage[] {
  const path = inboxPath(root, orgName);
  const draining = `${path}.draining`;
  if (existsSync(draining) || !existsSync(path)) {
    // An interrupted drain is pending recovery (or nothing is queued) — use
    // the recovering drain instead of renaming over it.
    const all = drainInbox(root, orgName);
    const taken: QueuedMessage[] = [];
    for (const m of all) {
      if (predicate(m)) taken.push(m);
      else queueMessage(root, orgName, m);
    }
    return taken;
  }
  try {
    renameSync(path, draining);
  } catch {
    return [];
  }
  let msgs: QueuedMessage[];
  try {
    msgs = parseLines(readFileSync(draining, 'utf8'));
  } catch {
    return []; // leave .draining for the next drain to recover
  }
  const taken: QueuedMessage[] = [];
  for (const m of msgs) {
    if (predicate(m)) taken.push(m);
    else if (!queueMessage(root, orgName, m)) return []; // keep .draining; nothing lost
  }
  try {
    unlinkSync(draining);
  } catch {
    /* recovered (possibly duplicated) by the next drain */
  }
  return taken;
}

export function inboxCount(root: string, orgName: string): number {
  const path = inboxPath(root, orgName);
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return 0;
  return raw.split('\n').length;
}
