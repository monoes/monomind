import { describe, it, expect, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint, CapabilityManager, codeCapability } from '../../src/capabilities/index.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('init integration', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('full flow: scan → activate → save fingerprint for code project', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'code-project'));
    const mgr = new CapabilityManager();
    mgr.register(codeCapability);

    await mgr.activateFromScan(scan, path.join(FIXTURES, 'code-project'));
    expect(mgr.isActive('code')).toBe(true);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-int-'));
    await saveFingerprint(scan, tmpDir);

    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.capabilities.code.confidence).toBeGreaterThan(0.1);
  });

  it('full flow: scan → activate for documents folder — code NOT active', async () => {
    const scan = await scanDirectory(path.join(FIXTURES, 'documents'));
    const mgr = new CapabilityManager();
    mgr.register(codeCapability);

    await mgr.activateFromScan(scan, path.join(FIXTURES, 'documents'));
    expect(mgr.isActive('code')).toBe(false);
  });
});
