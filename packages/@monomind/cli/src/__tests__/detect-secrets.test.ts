/**
 * detect-secrets had two independent gaps:
 *
 *   1. Every finding's `location.context` was the full, unescaped source
 *      line — sitting right next to the deliberately masked `location.masked`
 *      value, handing back exactly what masking exists to hide.
 *   2. `targetPath` reached the filesystem walker with no path validation at
 *      all, so a caller (or an agent following injected instructions) could
 *      point it at any readable path on disk and get real credentials
 *      echoed back into the calling LLM's context.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type DetectSecretsInput,
  handler,
} from '../mcp-tools/quality/security-compliance/detect-secrets.js';

// Built at runtime (not a literal) so it matches the aws-key pattern without
// this test file itself looking like it contains a real credential.
const FAKE_AWS_KEY = ['AKIA', 'ABCDEFGHIJKLMNOP'].join('');

function baseInput(targetPath: string): DetectSecretsInput {
  return {
    targetPath,
    secretTypes: ['aws-key'],
    excludePatterns: [],
    includeEntropy: false,
    entropyThreshold: 4.5,
    verifySecrets: false,
    scanHistory: false,
  };
}

async function run(input: DetectSecretsInput) {
  const result = await handler(input, { get: () => undefined });
  return JSON.parse(result.content[0].text);
}

describe('detect-secrets — context redaction', () => {
  // Must live inside process.cwd() — the path-containment fix (below) rejects
  // anything outside it, and this fixture needs to actually be scannable.
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(process.cwd(), '.tmp-detect-secrets-'));
    writeFileSync(join(dir, 'creds.env'), `AWS_KEY=${FAKE_AWS_KEY}\nother_line=fine\n`);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('never includes the raw secret in location.context', async () => {
    const output = await run(baseInput(dir));
    expect(output.success).toBe(true);
    expect(output.findings).toHaveLength(1);

    const [finding] = output.findings;
    expect(finding.location.masked).not.toBe(FAKE_AWS_KEY);
    expect(finding.location.context).not.toContain(FAKE_AWS_KEY);
    // Redacted, not just dropped — the masked form should still be visible for triage.
    expect(finding.location.context).toContain(finding.location.masked);
  });
});

describe('detect-secrets — targetPath containment', () => {
  it('rejects an absolute path outside the current working directory', async () => {
    const outside = tmpdir();
    const output = await run(baseInput(outside));
    expect(output.success).toBe(false);
    expect(output.error).toMatch(/targetPath/i);
    expect(output.findings).toEqual([]);
  });

  it('rejects a relative path that escapes cwd via ..', async () => {
    const output = await run(baseInput('../../../../etc'));
    expect(output.success).toBe(false);
    expect(output.error).toMatch(/targetPath/i);
  });

  it('still scans a legitimate path inside cwd', async () => {
    const dir = mkdtempSync(join(process.cwd(), '.tmp-detect-secrets-'));
    try {
      writeFileSync(join(dir, 'creds.env'), `AWS_KEY=${FAKE_AWS_KEY}\n`);
      const output = await run(baseInput(dir));
      expect(output.success).toBe(true);
      expect(output.findings).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
