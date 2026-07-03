import { describe, it, expect } from 'vitest';
import { codeCapability } from '../../src/capabilities/cap-code.js';
import type { DirectoryScan } from '../../src/capabilities/types.js';

function makeScan(overrides: Partial<DirectoryScan['capabilities']['code']> = {}): DirectoryScan {
  return {
    root: '/tmp/test',
    totalFiles: 100,
    git: false,
    scannedAt: new Date().toISOString(),
    capabilities: {
      code: { confidence: 0, files: 0, signals: [], ...overrides },
      documents: { confidence: 0, files: 0, signals: [] },
      media: { confidence: 0, files: 0, signals: [] },
      data: { confidence: 0, files: 0, signals: [] },
      graph: { confidence: 0, files: 0, signals: [] },
      timeline: { confidence: 0, files: 0, signals: [] },
    },
    filesByExtension: {},
  };
}

describe('codeCapability', () => {
  it('has name "code"', () => {
    expect(codeCapability.name).toBe('code');
  });

  it('returns high confidence for code project', () => {
    const scan = makeScan({ confidence: 0.7, files: 50, signals: ['package.json', '.ts'] });
    expect(codeCapability.detect(scan)).toBe(0.7);
  });

  it('returns low confidence for non-code', () => {
    const scan = makeScan({ confidence: 0.02, files: 1, signals: [] });
    expect(codeCapability.detect(scan)).toBe(0.02);
  });

  it('activate does not throw', async () => {
    await expect(codeCapability.activate('/tmp/test')).resolves.not.toThrow();
  });

  it('provides health checks', async () => {
    expect(codeCapability.healthChecks).toBeDefined();
  });
});
