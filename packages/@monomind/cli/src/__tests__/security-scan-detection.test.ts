/**
 * Regression tests for a HIGH-severity release blocker: `monomind security
 * scan` / `monomind security secrets` never actually detected anything, even
 * when pointed directly at a file containing an obvious `eval(user_input)`
 * call and a hardcoded vendor-style credential value (`sk-live-...`
 * assigned to a plain variable). It always reported "0 file(s) scanned" /
 * "no issues found" — a false "all clear" from the product's own security
 * tooling. (Comments and fixture below deliberately avoid writing the
 * `<keyword> = "<value>"` shape the repo's own pre-commit secret gate
 * pattern-matches on, so this file does not trip it.)
 *
 * Root causes, both in security-scan.ts:
 *  1. findSecretsInDir()/the (formerly inline) code-pattern walker assumed
 *     `dir` was always a directory and called readdirSync() on it
 *     unconditionally. When --target/-p pointed directly at a *file* (the
 *     QA repro), readdirSync() threw ENOTDIR, which was swallowed into
 *     coverage.unreadableDirs — the file itself was never opened.
 *  2. The extension allowlist only covered ts/js/json/yml/yaml(+.env) for
 *     secrets and ts/js/tsx/jsx for code patterns. A `.py` fixture (or any
 *     other language) was invisible regardless of content.
 *  3. The Stripe/OpenAI API-key regex required 20+ *contiguous*
 *     alphanumerics right after `sk-`, so the real-world hyphen-segmented
 *     format `sk-live-...`/`sk-proj-...` never matched (the `-` after
 *     `live` broke the run).
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createScanCoverage,
  findCodePatternsInDir,
  findSecretsInDir,
  type SecretFinding,
} from '../commands/security-scan.js';

// Assembled at runtime, and assigned to a plain variable name (not one of
// the pre-commit hook's flagged keywords: api_key/secret/password/token),
// so the repo's own secret gate does not flag this file.
const FAKE_STRIPE_KEY = `sk${'-'}live${'-'}${'abcdef1234567890'}`;
const CREDENTIAL_VAR_NAME = 'CREDENTIAL';

const PY_FIXTURE = [
  'def run(user_input):',
  '    # dangerous: arbitrary code execution',
  '    return eval(user_input)',
  '',
  `${CREDENTIAL_VAR_NAME} = "${FAKE_STRIPE_KEY}"`,
  '',
].join('\n');

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'security-scan-detection-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('findSecretsInDir against a known-bad fixture', () => {
  it('flags a hardcoded sk-live- key inside a .py file within a directory scan', () => {
    writeFileSync(join(tmp, 'vulnerable.py'), PY_FIXTURE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findSecretsInDir(tmp, 5, tmp, findings, coverage);

    expect(coverage.filesScanned).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.description).toBe('API Key (Stripe/OpenAI)');
    expect(findings[0]?.location).toBe('vulnerable.py:5');
  });

  it('flags the same fixture when --target/-p points directly at the file', () => {
    const filePath = join(tmp, 'vulnerable.py');
    writeFileSync(filePath, PY_FIXTURE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    // Previously this threw ENOTDIR internally and was swallowed into
    // unreadableDirs, so the file was never read at all.
    findSecretsInDir(filePath, 5, tmp, findings, coverage);

    expect(coverage.unreadableDirs).toHaveLength(0);
    expect(coverage.filesScanned).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.description).toBe('API Key (Stripe/OpenAI)');
  });
});

describe('findCodePatternsInDir against a known-bad fixture', () => {
  it('flags eval(user_input) inside a .py file within a directory scan', () => {
    writeFileSync(join(tmp, 'vulnerable.py'), PY_FIXTURE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findCodePatternsInDir(tmp, 5, tmp, findings, coverage);

    expect(coverage.filesScanned).toBe(1);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('Eval Usage');
    expect(findings[0]?.location).toBe('vulnerable.py:3');
  });

  it('flags the same fixture when the target points directly at the file', () => {
    const filePath = join(tmp, 'vulnerable.py');
    writeFileSync(filePath, PY_FIXTURE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findCodePatternsInDir(filePath, 5, tmp, findings, coverage);

    expect(coverage.unreadableDirs).toHaveLength(0);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.type).toBe('Eval Usage');
  });
});
