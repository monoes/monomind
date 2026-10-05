// packages/@monomind/cli/src/orgrt/documents/envelope.ts
/**
 * GA row R2 (spec 9.3; 6.2 control delivery, A40): authenticated routing tags.
 *
 * `mailRouteKey` reads `[task:<id>]` from the subject of agent mail, and an agent
 * writes its own subject, so any role could steer its message into another task's
 * session by typing the tag. In a sections org the daemon therefore (1) neutralises
 * every task/loadout/env tag in an agent's subject, (2) re-adds `[task:<id>]
 * [env:<messageId>.<mac>]` itself, and only when the task is held by the sender or
 * the recipient, and (3) routes by a tag only when its MAC verifies. The MAC covers
 * run, sender, recipient, task and message id under a per-org key the roles cannot
 * read (the envelope directory is denied to every role in session-run.ts), so an
 * envelope copied from one message fails for any other sender, recipient or task.
 * Runtime-authored dispatch paragraphs are not agent mail and are read as before.
 * Orgs without sections do not use any of this.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface EnvelopeFields {
  run: string;
  from: string;
  to: string;
  task: string;
  id: string;
}

/** Decides whether a head's task tag is authentic: (sender, subject, taskId) => ok. */
export type EnvelopeVerify = (from: string, subject: string, task: string) => boolean;

export const envelopeDirFor = (orgDir: string): string => join(orgDir, 'envelope');

/** The org's MAC key, created on first use (0600) and stable across runs and resumes. */
export function loadEnvelopeKey(orgDir: string): Buffer {
  const dir = envelopeDirFor(orgDir);
  const file = join(dir, 'key');
  try {
    const k = readFileSync(file);
    if (k.length === 32) return k;
  } catch {
    /* create below */
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = randomBytes(32);
  try {
    writeFileSync(file, key, { flag: 'wx', mode: 0o600 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    return readFileSync(file); // another daemon of this host won the race
  }
  chmodSync(file, 0o600);
  return key;
}

export function envelopeMac(key: Buffer, f: EnvelopeFields): string {
  return createHmac('sha256', key)
    .update([f.run, f.from, f.to, f.task, f.id].join('\0'))
    .digest('hex')
    .slice(0, 32);
}

/** Makes every routing tag in agent text inert: `[task:x]` becomes `(task:x)`. */
export function neutralizeTags(text: string): string {
  return text.replace(/\[(task|loadout|env):([^\]]*)\]/g, '($1:$2)');
}

/** The sealed subject suffix for a task route. */
export function sealTag(key: Buffer, f: EnvelopeFields): string {
  return `[task:${f.task}] [env:${f.id}.${envelopeMac(key, f)}]`;
}

/** A verifier for the mail `me` receives in `run`. */
export function envelopeVerifier(key: Buffer, run: string, me: string): EnvelopeVerify {
  return (from, subject, task) => {
    const m = /\[env:([^\].]+)\.([0-9a-f]{32})\]/.exec(subject);
    if (!m) return false;
    const want = Buffer.from(envelopeMac(key, { run, from, to: me, task, id: m[1] }));
    const got = Buffer.from(m[2]);
    return want.length === got.length && timingSafeEqual(want, got);
  };
}
