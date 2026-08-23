/**
 * Regression tests for "an error must never be presentable as a successful zero".
 *
 * Four separate scanners/readers used to swallow their own failures and return
 * an empty/clean-looking result:
 *   (a) security secret scanner  — unreadable dirs + depth truncation
 *   (b) embeddings_neural drift/consolidate — read singleton before init
 *   (c) getGitDiffNumstat        — git failure returned []
 *   (d) consensus audit readLines — >50MB error swallowed to []
 */

import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createScanCoverage,
  findSecretsInDir,
  type SecretFinding,
  scanWasIncomplete,
} from '../commands/security-scan.js';
import { AuditWriter } from '../consensus/audit-writer.js';
import { getGitDiffNumstat } from '../monovector/diff-classifier.js';

// Assembled at runtime so the repo's own secret gate does not flag this file.
const FAKE_AWS_KEY = `${['A', 'K', 'I', 'A'].join('')}ABCDEFGHIJKLMNOP`;
const SECRET_LINE = `const k = "${FAKE_AWS_KEY}";\n`;

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'scan-incomplete-'));
});

afterEach(() => {
  try {
    chmodSync(join(tmp, 'locked'), 0o755);
  } catch {
    /* may not exist */
  }
  rmSync(tmp, { recursive: true, force: true });
});

// ─── (a) secret scanner ──────────────────────────────────────────────────────

describe('findSecretsInDir coverage reporting', () => {
  it('records unreadable directories instead of silently returning clean', () => {
    const locked = join(tmp, 'locked');
    mkdirSync(locked);
    writeFileSync(join(locked, 'creds.ts'), SECRET_LINE);
    chmodSync(locked, 0o000);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findSecretsInDir(tmp, 5, tmp, findings, coverage);

    // The secret inside the locked dir is unreachable — that must be visible.
    expect(findings).toHaveLength(0);
    expect(coverage.unreadableDirs.length).toBeGreaterThan(0);
    expect(scanWasIncomplete(coverage)).toBe(true);
  });

  it('records directories cut off by the depth limit', () => {
    // depth limit 2 => tmp (2) -> a (1) -> b (0, truncated)
    const deep = join(tmp, 'a', 'b');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'creds.ts'), SECRET_LINE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findSecretsInDir(tmp, 2, tmp, findings, coverage);

    expect(findings).toHaveLength(0);
    expect(coverage.depthTruncatedDirs.length).toBeGreaterThan(0);
    expect(scanWasIncomplete(coverage)).toBe(true);
  });

  it('reports a genuinely complete clean scan as complete', () => {
    writeFileSync(join(tmp, 'ok.ts'), 'export const x = 1;\n');

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findSecretsInDir(tmp, 5, tmp, findings, coverage);

    expect(findings).toHaveLength(0);
    expect(scanWasIncomplete(coverage)).toBe(false);
    expect(coverage.filesScanned).toBe(1);
  });

  it('still finds secrets and counts scanned files', () => {
    writeFileSync(join(tmp, 'bad.ts'), SECRET_LINE);

    const findings: SecretFinding[] = [];
    const coverage = createScanCoverage();
    findSecretsInDir(tmp, 5, tmp, findings, coverage);

    expect(findings).toHaveLength(1);
    expect(coverage.filesScanned).toBe(1);
    expect(scanWasIncomplete(coverage)).toBe(false);
  });
});

// ─── (c) git diff ────────────────────────────────────────────────────────────

describe('getGitDiffNumstat git failure', () => {
  it('throws instead of returning an empty (clean-looking) diff', () => {
    const cwd = process.cwd();
    try {
      process.chdir(tmp); // not a git repo
      // unique ref so the module-level diff cache cannot serve a stale hit
      const ref = `HEAD~${Math.floor(Math.random() * 100000)}`;
      expect(() => getGitDiffNumstat(ref)).toThrow(/git diff failed for ref/i);
    } finally {
      process.chdir(cwd);
    }
  });

  it('analyze_diff-* MCP handlers report an error, not "0 files changed"', async () => {
    const { analyzeTools } = await import('../mcp-tools/analyze-tools.js');
    const cwd = process.cwd();
    try {
      process.chdir(tmp); // not a git repo
      for (const name of [
        'analyze_diff-risk',
        'analyze_diff-classify',
        'analyze_diff-stats',
        'analyze_diff-reviewers',
        'analyze_diff',
      ]) {
        const tool = analyzeTools.find((t) => t.name === name);
        expect(tool, `${name} missing`).toBeDefined();
        const ref = `HEAD~${Math.floor(Math.random() * 100000)}`;
        const res = (await tool?.handler({ ref })) as Record<string, unknown>;
        expect(res.error, `${name} should report an error`).toBe(true);
        expect(String(res.message)).toMatch(/git diff failed/i);
      }
    } finally {
      process.chdir(cwd);
    }
  });
});

// ─── (d) consensus audit reader ──────────────────────────────────────────────

describe('AuditWriter read failures', () => {
  // AuditWriter refuses dataDirs outside cwd, so these live under the package dir.
  let auditTmp: string;

  beforeEach(() => {
    auditTmp = mkdtempSync(join(process.cwd(), '.tmp-audit-'));
  });
  afterEach(() => {
    rmSync(auditTmp, { recursive: true, force: true });
  });

  it('returns an empty list when the audit log genuinely does not exist', () => {
    const writer = new AuditWriter(join(auditTmp, 'consensus'));
    expect(writer.listDecisions()).toEqual([]);
  });

  it('throws rather than reporting an empty trail when the log exceeds the size cap', () => {
    const dir = join(auditTmp, 'consensus');
    const writer = new AuditWriter(dir);
    const auditPath = join(dir, 'consensus-audit.jsonl');
    // Sparse file: 51MB apparent size, ~0 bytes on disk.
    const fd = openSync(auditPath, 'w');
    closeSync(fd);
    truncateSync(auditPath, 51 * 1024 * 1024);

    expect(() => writer.listDecisions()).toThrow(/50MB/);
    expect(() => writer.verifyDecision('d1', 'secret')).toThrow(/50MB/);
  });
});
