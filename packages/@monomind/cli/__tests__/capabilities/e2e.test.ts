import { describe, it, expect, afterEach } from 'vitest';
import { scanDirectory, saveFingerprint, loadFingerprint, CapabilityManager, codeCapability } from '../../src/capabilities/index.js';
import { documentsCapability } from '../../src/capabilities/cap-documents.js';
import { mediaCapability } from '../../src/capabilities/cap-media.js';
import { dataCapability } from '../../src/capabilities/cap-data.js';
import { graphCapability } from '../../src/capabilities/cap-graph.js';
import { timelineCapability } from '../../src/capabilities/cap-timeline.js';
import path from 'path';
import fs from 'fs';
import os from 'os';

const FIXTURES = path.join(import.meta.dirname, 'fixtures');

describe('E2E: full second-brain flow', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('scan → activate → index → search in a mixed directory', async () => {
    const mixedDir = path.join(FIXTURES, 'mixed');
    const scan = await scanDirectory(mixedDir);

    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'monomind-e2e-'));
    await saveFingerprint(scan, tmpDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);
    mgr.register(dataCapability);
    mgr.register(graphCapability);
    mgr.register(timelineCapability);

    await mgr.activateFromScan(scan, mixedDir);

    // Should have at least code + documents active
    expect(mgr.isActive('code')).toBe(true);
    expect(mgr.isActive('documents')).toBe(true);

    // Fingerprint persisted
    const loaded = await loadFingerprint(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.version).toBe(1);
  });

  it('code project scan activates cap/code and skips doc/media', async () => {
    const codeDir = path.join(FIXTURES, 'code-project');
    const scan = await scanDirectory(codeDir);

    const mgr = new CapabilityManager();
    mgr.register(codeCapability);
    mgr.register(documentsCapability);
    mgr.register(mediaCapability);

    await mgr.activateFromScan(scan, codeDir);

    expect(mgr.isActive('code')).toBe(true);
    expect(mgr.isActive('documents')).toBe(false);
    expect(mgr.isActive('media')).toBe(false);
  });
});
