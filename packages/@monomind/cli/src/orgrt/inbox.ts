// packages/@monomind/cli/src/orgrt/inbox.ts
// Persistent message queue for offline orgs. Messages that can't be delivered
// (target org not running) are spooled here and drained when the org starts.
import { appendFileSync, readFileSync, renameSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { ORG_DIR } from './types.js';

export interface QueuedMessage {
  fromQualified: string;  // "orgA:role"
  toRole: string;
  subject: string;
  body: string;
  ts: number;
}

function inboxPath(root: string, orgName: string): string {
  return join(root, ORG_DIR, orgName, 'inbox.jsonl');
}

export function queueMessage(root: string, orgName: string, msg: QueuedMessage): boolean {
  try {
    const dir = join(root, ORG_DIR, orgName);
    mkdirSync(dir, { recursive: true });
    appendFileSync(inboxPath(root, orgName), JSON.stringify(msg) + '\n');
    return true;
  } catch (err) {
    // Log error but don't throw — caller needs to know delivery failed
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error(`[inbox] queueMessage failed for org "${orgName}":`, err instanceof Error ? err.message : err);
    return false;
  }
}

function parseLines(raw: string): QueuedMessage[] {
  const msgs: QueuedMessage[] = [];
  for (const line of raw.trim().split('\n')) {
    if (!line) continue;
    try { msgs.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
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
      if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[inbox] drainInbox recovery of .draining failed:', e);
      return msgs; // don't rename over a file we couldn't consume
    }
  }

  if (!existsSync(path)) return msgs;
  // Rename-then-read: if the process crashes after rename but before we finish
  // reading, the .draining file survives (and is recovered above on the next
  // drain). A plain read-then-truncate would lose messages on a mid-drain crash.
  try { renameSync(path, draining); } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[inbox] drainInbox rename failed:', e);
    return msgs;
  }
  let raw = '';
  try { raw = readFileSync(draining, 'utf8'); } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[inbox] drainInbox read failed:', e);
    return msgs;
  }
  msgs.push(...parseLines(raw));
  // Unlink the drained snapshot rather than truncating it and renaming it back over
  // `path`. A sender that appended between the rename above and this point created a
  // fresh `path` (queueMessage mkdir+appends), and renaming the emptied snapshot back
  // would clobber it — destroying messages whose sender already got a "queued" receipt.
  // Those messages now simply stay in `path` and are picked up by the next drain.
  try { unlinkSync(draining); } catch (e) {
    if (process.env.DEBUG || process.env.MONOMIND_DEBUG) console.error('[inbox] drainInbox unlink failed:', e);
  }
  return msgs;
}

export function inboxCount(root: string, orgName: string): number {
  const path = inboxPath(root, orgName);
  if (!existsSync(path)) return 0;
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) return 0;
  return raw.split('\n').length;
}
