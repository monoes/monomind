// packages/@monomind/cli/__tests__/resource-governor.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const execSyncMock = vi.fn();
vi.mock('node:child_process', () => ({ execSync: (...args: unknown[]) => execSyncMock(...args) }));

const platformMock = vi.fn(() => 'darwin');
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, platform: () => platformMock() };
});

describe('getAvailableMemBytes', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    platformMock.mockReturnValue('darwin');
  });
  afterEach(() => vi.resetModules());

  it('on darwin, counts reclaimable inactive/speculative pages as available (not just literally-free pages)', async () => {
    // Regression: os.freemem() on macOS only reports strictly-free pages, excluding
    // "inactive"/"speculative" pages the kernel reclaims instantly on demand — this
    // makes checkResources() report near-zero availability on any macOS box with
    // uptime, even when 15%+ of memory is genuinely available. vm_stat's own
    // breakdown is the source of truth for what's actually reclaimable.
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

  it('falls back to os.freemem() when vm_stat is unavailable or platform is not darwin', async () => {
    platformMock.mockReturnValue('linux');
    const { getAvailableMemBytes } = await import('../src/utils/resource-governor.js');
    const os = await import('node:os');
    expect(getAvailableMemBytes()).toBe(os.freemem());
  });
});
