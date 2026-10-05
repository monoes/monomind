// packages/@monomind/cli/src/orgrt/documents/mail-integrity.ts
/**
 * GA row R4 (spec 9.3; 6.1 mail-digest row): digests of a sections org are
 * written by the daemon only, as immutable files, and each one's content hash
 * is journalled before the file is written. A retry must present identical
 * content; a missing, replaced, altered or symlinked digest is a
 * delivery-integrity blocker (DigestIntegrityError), never mail that looks like
 * it came from the sender. Agents cannot write here at all: the file tools, the
 * SDK sandbox and the authority mask deny `<orgDir>/mail` (wired in session-run.ts).
 */
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mailDirFor, mailRootFor } from './mail-isolation.js';

export class DigestIntegrityError extends Error {
  code: 'DIGEST_CONFLICT' | 'DIGEST_ALTERED' | 'DIGEST_MISSING' | 'DIGEST_NOT_A_FILE';
  constructor(code: DigestIntegrityError['code'], message: string) {
    super(message);
    this.name = 'DigestIntegrityError';
    this.code = code;
  }
}

export const digestJournalPath = (orgDir: string): string =>
  join(mailRootFor(orgDir), 'digests.jsonl');

const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

const journalEntry = (orgDir: string, to: string, id: string): { sha256: string } | undefined => {
  let text: string;
  try {
    text = readFileSync(digestJournalPath(orgDir), 'utf8');
  } catch {
    return undefined;
  }
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const e = JSON.parse(line) as { id?: string; to?: string; sha256?: string };
      if (e.id === id && e.to === to && typeof e.sha256 === 'string') return { sha256: e.sha256 };
    } catch {
      /* a torn final line is not an entry */
    }
  }
  return undefined;
};

/** The file must be a regular file whose bytes hash to `want`. */
function checkFile(file: string, want: string, id: string): void {
  let st: ReturnType<typeof lstatSync>;
  try {
    st = lstatSync(file);
  } catch {
    throw new DigestIntegrityError('DIGEST_MISSING', `the digest of message ${id} is missing`);
  }
  if (!st.isFile())
    throw new DigestIntegrityError(
      'DIGEST_NOT_A_FILE',
      `the digest of message ${id} is not a regular file`,
    );
  if (sha256(readFileSync(file)) !== want)
    throw new DigestIntegrityError('DIGEST_ALTERED', `the digest of message ${id} was altered`);
}

/**
 * Writes the digest of message `id` for `to` and returns its path, or checks it
 * when this id was already written (a retry). Throws DigestIntegrityError on any
 * mismatch; other I/O errors propagate.
 */
export function writeDigest(orgDir: string, to: string, id: string, body: string): string {
  const file = join(mailDirFor(orgDir, to), `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`);
  const hash = sha256(body);
  const known = journalEntry(orgDir, to, id);
  if (known) {
    if (known.sha256 !== hash)
      throw new DigestIntegrityError(
        'DIGEST_CONFLICT',
        `message ${id} was already issued with different content`,
      );
    checkFile(file, hash, id);
    return file;
  }
  try {
    if (!lstatSync(file).isFile())
      throw new DigestIntegrityError(
        'DIGEST_NOT_A_FILE',
        `the digest of message ${id} is not a regular file`,
      );
  } catch (e) {
    if (e instanceof DigestIntegrityError) throw e;
    /* nothing there yet: the normal case */
  }
  mkdirSync(mailDirFor(orgDir, to), { recursive: true });
  // The hash is recorded before the file exists, so a crash between the two leaves a
  // journalled hash and a missing file: a blocker, not a digest nobody can check.
  appendFileSync(
    digestJournalPath(orgDir),
    `${JSON.stringify({ id, to, sha256: hash, ts: new Date().toISOString() })}\n`,
  );
  try {
    writeFileSync(file, body, { flag: 'wx', mode: 0o444 });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    checkFile(file, hash, id);
  }
  return file;
}
