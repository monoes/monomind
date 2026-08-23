/**
 * C5 — Emit a runnable sample org on `monomind init`.
 *
 * The README has always told users to "see `.monomind/orgs/sample-team.json`
 * in a fresh `monomind init`" — but no such file was ever written, and the
 * real templates (`content-team` / `dev-team` / `research-pod`) lived behind
 * `org create --template`, which the README never mentioned.
 *
 * This module bridges that gap. It derives the sample from the existing
 * schema-validated `content-team` template, so the user gets a file that
 * runs immediately: `monomind org run sample-team`.
 *
 * Re-running init does NOT overwrite the user's edits — if the file already
 * exists we leave it alone (matches the convention used for CAPABILITIES.md
 * and other generated docs).
 */
import fs from 'node:fs';
import path from 'node:path';
import { buildFromTemplate } from '../orgrt/templates.js';

/**
 * Write `.monomind/orgs/sample-team.json` if it does not already exist.
 *
 * @param targetDir project root init is running against
 * @returns true if the file was written, false if it already existed
 *          (so the caller can record skipped vs. updated in the InitResult)
 */
export function writeSampleOrg(targetDir: string): boolean {
  const orgsDir = path.join(targetDir, '.monomind', 'orgs');
  const samplePath = path.join(orgsDir, 'sample-team.json');

  if (fs.existsSync(samplePath)) return false;

  const org = buildFromTemplate('content-team', 'sample-team');
  if (!org) return false;

  fs.mkdirSync(orgsDir, { recursive: true });
  fs.writeFileSync(samplePath, `${JSON.stringify(org, null, 2)}\n`, 'utf-8');
  return true;
}
