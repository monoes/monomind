/**
 * C5 — README onboarding points at a sample-team.json that doesn't exist
 *
 * Before fix: README.md:124 and :239 tell users to run `monomind org run
 * my-team` and to "see `.monomind/orgs/sample-team.json` in a fresh
 * `monomind init` for a working example." The init executor never wrote
 * such a file — the headline feature had no working front door. The real
 * templates (content-team / dev-team / research-pod) lived behind a
 * subcommand (`org create --template`) the README never mentioned.
 *
 * After fix: init writes `.monomind/orgs/sample-team.json` derived from
 * the existing `content-team` template (already schema-validated). The
 * file is immediately runnable: `monomind org run sample-team`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

describe('C5 — init emits a runnable sample org', () => {
  let tmpDir: string;
  let originalCwd: () => string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mono-sample-org-'));
    originalCwd = process.cwd;
    process.cwd = () => tmpDir;
  });

  afterEach(() => {
    process.cwd = originalCwd;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeSampleOrg writes a schema-valid sample-team.json into .monomind/orgs/', async () => {
    const { writeSampleOrg } = await import(
      '../../packages/@monomind/cli/src/init/write-sample-org.js'
    );
    const result = writeSampleOrg(tmpDir);
    expect(result).toBe(true);

    const samplePath = path.join(tmpDir, '.monomind', 'orgs', 'sample-team.json');
    expect(fs.existsSync(samplePath)).toBe(true);

    const parsed = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    expect(parsed.name).toBe('sample-team');
    expect(Array.isArray(parsed.roles)).toBe(true);
    expect(parsed.roles.length).toBeGreaterThan(0);
    // Schema-required fields
    expect(parsed.goal).toBeTruthy();
    expect(parsed.run_config).toBeDefined();
    expect(parsed.status).toBe('stopped');
  });

  it('does not overwrite an existing sample-team.json on re-init', async () => {
    const { writeSampleOrg } = await import(
      '../../packages/@monomind/cli/src/init/write-sample-org.js'
    );
    const orgsDir = path.join(tmpDir, '.monomind', 'orgs');
    fs.mkdirSync(orgsDir, { recursive: true });
    const samplePath = path.join(orgsDir, 'sample-team.json');
    fs.writeFileSync(samplePath, JSON.stringify({ custom: 'user edit' }));

    const result = writeSampleOrg(tmpDir);
    expect(result).toBe(false);

    // User's version is preserved
    const after = JSON.parse(fs.readFileSync(samplePath, 'utf-8'));
    expect(after.custom).toBe('user edit');
  });
});
