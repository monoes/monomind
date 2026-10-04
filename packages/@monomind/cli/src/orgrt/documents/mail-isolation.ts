// packages/@monomind/cli/src/orgrt/documents/mail-isolation.ts
/**
 * GA row R3 (spec 9.3; 6.1 mail-digest row): where a sections org keeps the
 * full text of a long message, and which of those directories a role may not
 * read. A digest is written by the daemon into `<orgDir>/mail/<recipient>/`,
 * and every OTHER role is denied reading that directory (file tools, SDK
 * sandbox and authority mask, wired in session-run.ts). Without sections nothing
 * here applies and `<workdir>/.mail` stays as it is.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sectionsSurface } from './surface.js';

const safe = (role: string): string => role.replace(/[^A-Za-z0-9._-]/g, '_');

/** The digest directory of one recipient. */
export function mailDirFor(orgDir: string, role: string): string {
  return join(orgDir, 'mail', safe(role));
}

interface DefLike {
  sections?: unknown;
  roles: { id: string }[];
}

/** Every other role's digest directory; empty for an org without sections. */
export function otherMailDirs(def: DefLike | undefined, orgDir: string, role: string): string[] {
  if (!def || !sectionsSurface(def).enabled) return [];
  return def.roles.filter((r) => r.id !== role).map((r) => mailDirFor(orgDir, r.id));
}

/** Creates every role's digest directory (so the sandbox can deny the ones that exist). */
export function ensureMailDirs(def: DefLike | undefined, orgDir: string): void {
  if (!def || !sectionsSurface(def).enabled) return;
  for (const r of def.roles) mkdirSync(mailDirFor(orgDir, r.id), { recursive: true });
}
