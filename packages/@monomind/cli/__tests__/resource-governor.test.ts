// packages/@monomind/cli/__tests__/resource-governor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));
vi.mock('child_process', () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));

const platformMock = vi.fn(() => 'darwin');
const freememMock = vi.fn(() => 999_999_999);
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => platformMock(), freemem: () => freememMock() };
});

describe('getAvailableMemBytes', () => {
  beforeEach(() => {
    vi.resetModules();
    execSyncMock.mockReset();
    platformMock.mockReturnValue('darwin');
  });

  it('on darwin, counts reclaimable inactive/speculative pages as available', async () => {
    execSyncMock.mockReturnValue(`Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4028.
Pages active:                                  81216.
Pages inactive:                                76667.
Pages speculative:                              3871.
Pages throttled:                                   0.
Pages wired down:                             141985.
Pages purgeable:                                   4.
`);
    const { getAvailableMemBytes } = await import('../src/utils/resource-governor.js');
    const bytes = getAvailableMemBytes();
    // (4028 free + 76667 inactive + 3871 speculative + 4 purgeable) * 16384
    expect(bytes).toBe(84570 * 16384);
  });

  it('falls back to freemem() when platform is not darwin', async () => {
    platformMock.mockReturnValue('linux');
    freememMock.mockReturnValue(123_456_789);
    const { getAvailableMemBytes } = await import('../src/utils/resource-governor.js');
    expect(getAvailableMemBytes()).toBe(123_456_789);
  });
});
