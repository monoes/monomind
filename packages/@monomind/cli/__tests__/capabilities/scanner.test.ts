import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint } from '../../src/capabilities/scanner.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('scanDirectory', () => {
  it('detects a code project', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'code-project'));
    expect(scan.git).toBe(true);
    expect(scan.capabilities.code.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.code.signals).toContain('package.json');
  });

  it('detects a documents folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.documents.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.code.confidence).toBeLessThan(0.1);
  });

  it('detects a photos folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'photos'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.media.confidence).toBeGreaterThan(0.1);
  });

  it('detects a data folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'data'));
    expect(scan.git).toBe(false);
    expect(scan.capabilities.data.confidence).toBeGreaterThan(0.1);
  });

  it('detects a mixed folder', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'mixed'));
    expect(scan.capabilities.code.confidence).toBeGreaterThan(0.1);
    expect(scan.capabilities.documents.confidence).toBeGreaterThan(0.1);
  });

  it('respects maxDepth option', async () => {
    const shallow = await scanDirectory(path.join(FIXTURES, 'code-project'), { maxDepth: 0 });
    // maxDepth 0 = root only, won't see src/index.ts
    expect(shallow.totalFiles).toBeLessThan(
      (await scanDirectory(path.join(FIXTURES, 'code-project'))).totalFiles
    );
  });

  it('produces an ISO timestamp', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    expect(() => new Date(scan.scannedAt)).not.toThrow();
  });
});

describe('fingerprint persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a fingerprint', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    await saveFingerprint(scan, tmpDir);

    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
    expect(loaded!.totalFiles).toBe(scan.totalFiles);
    expect(loaded!.capabilities.documents.confidence).toBe(scan.capabilities.documents.confidence);
  });

  it('returns null when no fingerprint exists', async () => {
    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).toBeNull();
  });
});
