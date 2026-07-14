// packages/@monomind/cli/src/orgrt/inbox.ts
// Persistent message queue for offline orgs. Messages that can't be delivered
// (target org not running) are spooled here and drained when the org starts.
import { appendFileSync, readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
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

export function queueMessage(root: string, orgName: string, msg: QueuedMessage): void {
  const dir = join(root, ORG_DIR, orgName);
  mkdirSync(dir, { recursive: true });
  appendFileSync(inboxPath(root, orgName), JSON.stringify(msg) + '\n');
}

export function drainInbox(root: string, orgName: string): QueuedMessage[] {
  const path = inboxPath(root, orgName);
  if (!existsSync(path)) return [];
  // Rename-then-read: if the process crashes after rename but before we finish
  // reading, the .draining file survives for manual recovery. A plain
  // read-then-truncate would lose messages on a mid-drain crash.
  const draining = `${path}.draining`;
  try { renameSync(path, draining); } catch { return []; }
  const raw = readFileSync(draining, 'utf8').trim();
  if (!raw) { writeFileSync(draining, ''); renameSync(draining, path); return []; }
  // Clear the draining file — messages are now the caller's responsibility
  writeFileSync(draining, '');
  renameSync(draining, path);
  const msgs: QueuedMessage[] = [];
  for (const line of raw.split('\n')) {
    try { msgs.push(JSON.parse(line)); } catch { /* skip corrupt lines */ }
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
