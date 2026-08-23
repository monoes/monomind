/**
 * C1 — Command injection in document extraction (cap-documents.ts)
 *
 * Before fix: `extractText()` for .doc/.ppt/.pages and zip-based formats
 * (pptx/odt/odp/epub) built shell strings via template literals +
 * JSON.stringify, which does NOT escape $(...), `...`, or ${...} inside
 * double quotes. A malicious filename or zip-entry name could execute
 * arbitrary commands when indexed.
 *
 * After fix: the same paths use execFile/execFileSync with arg arrays
 * (no shell), so no shell expansion is possible.
 *
 * Verification probe: a file whose name contains `$(echo PWNED > probe)`
 * is passed to extractText. If the shell evaluates the expansion, the
 * probe file is created. If the implementation is shell-less, the probe
 * never exists.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extractText } from '../../packages/@monomind/cli/src/capabilities/cap-documents.js';

describe('C1 — cap-documents command injection', () => {
  let tmpDir: string;
  // Unique probe name (no slashes) so the FS doesn't confuse the embedded
  // shell expansion with a path. The probe is written to the spawned
  // shell's cwd (= Node's cwd) if the injection fires.
  const PROBE_NAME = `mono-c1-pwned-${process.pid}-${Date.now()}`;
  const PROBE_ABS = path.join(process.cwd(), PROBE_NAME);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-cap-doc-'));
    if (fs.existsSync(PROBE_ABS)) fs.rmSync(PROBE_ABS);
  });

  afterEach(() => {
    if (fs.existsSync(PROBE_ABS)) fs.rmSync(PROBE_ABS);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const makeFileEntry = (filePath: string, extension: string) => ({
    absolutePath: filePath,
    path: path.basename(filePath),
    extension,
    size: fs.statSync(filePath).size,
    modified: new Date(),
    created: new Date(),
  });

  it('does NOT execute $(...) in a .doc filename (textutil path)', async () => {
    const maliciousPath = path.join(tmpDir, `probe$(echo PWNED > ${PROBE_NAME}).doc`);
    fs.writeFileSync(maliciousPath, 'not a real doc');
    await extractText(makeFileEntry(maliciousPath, '.doc'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });

  it('does NOT execute $(...) in a .ppt filename (textutil path)', async () => {
    const maliciousPath = path.join(tmpDir, `slides$(echo PWNED > ${PROBE_NAME}).ppt`);
    fs.writeFileSync(maliciousPath, 'not a real ppt');
    await extractText(makeFileEntry(maliciousPath, '.ppt'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });

  it('does NOT execute $(...) in a .pages filename (textutil path)', async () => {
    const maliciousPath = path.join(tmpDir, `doc$(echo PWNED > ${PROBE_NAME}).pages`);
    fs.writeFileSync(maliciousPath, 'not a real pages');
    await extractText(makeFileEntry(maliciousPath, '.pages'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });

  it('does NOT execute $(...) in a .odt filename (unzip path)', async () => {
    const maliciousPath = path.join(tmpDir, `book$(echo PWNED > ${PROBE_NAME}).odt`);
    fs.writeFileSync(maliciousPath, 'not a real odt');
    await extractText(makeFileEntry(maliciousPath, '.odt'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });

  it('does NOT execute $(...) in an .epub filename (unzip path)', async () => {
    const maliciousPath = path.join(tmpDir, `book$(echo PWNED > ${PROBE_NAME}).epub`);
    fs.writeFileSync(maliciousPath, 'not a real epub');
    await extractText(makeFileEntry(maliciousPath, '.epub'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });

  it('does NOT execute backtick expansions in filenames', async () => {
    const maliciousPath = path.join(tmpDir, `p\`echo PWNED > ${PROBE_NAME}\`.doc`);
    fs.writeFileSync(maliciousPath, 'probe');
    await extractText(makeFileEntry(maliciousPath, '.doc'));
    expect(fs.existsSync(PROBE_ABS)).toBe(false);
  });
});
