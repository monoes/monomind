/**
 * Regression tests for CMD-20: `memory search --type semantic|keyword|hybrid`
 * was accepted but never threaded through to the search backend, so a user
 * requesting `--type keyword` could silently get semantic results (or vice
 * versa) with no indication their flag did nothing. This pins the minimal
 * viable fix: when the actual `searchMethod` the backend used doesn't match
 * the requested `--type`, a warning is printed (and reflected in --format
 * json) rather than the mismatch being swallowed.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from '../types.js';

function makeCtx(flags: Record<string, unknown>): CommandContext {
  return {
    args: [],
    flags: { _: [], query: 'q', ...flags } as CommandContext['flags'],
    cwd: process.cwd(),
    interactive: false,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

describe('memory search --type vs actual searchMethod', () => {
  it('warns when --type keyword was requested but the backend used semantic', async () => {
    vi.doMock('../memory/memory-initializer.js', () => ({
      searchEntries: vi.fn(async () => ({
        success: true,
        results: [],
        searchTime: 1,
        searchMethod: 'semantic',
      })),
    }));

    const { searchCommand } = await import('../commands/memory-crud.js');
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    await searchCommand.action?.(makeCtx({ type: 'keyword' }));

    expect(written.join('')).toContain(
      'Requested --type keyword but the backend used method "semantic" instead.',
    );
  });

  it('does not warn when the requested type matches the actual method', async () => {
    vi.doMock('../memory/memory-initializer.js', () => ({
      searchEntries: vi.fn(async () => ({
        success: true,
        results: [],
        searchTime: 1,
        searchMethod: 'semantic',
      })),
    }));

    const { searchCommand } = await import('../commands/memory-crud.js');
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    await searchCommand.action?.(makeCtx({ type: 'semantic' }));

    expect(written.join('')).not.toContain('Requested --type');
  });

  it('treats keyword-fallback as the keyword family — no mismatch warning for --type keyword', async () => {
    vi.doMock('../memory/memory-initializer.js', () => ({
      searchEntries: vi.fn(async () => ({
        success: true,
        results: [],
        searchTime: 1,
        searchMethod: 'keyword-fallback',
        fallbackReason: 'no-embedding-model',
      })),
    }));

    const { searchCommand } = await import('../commands/memory-crud.js');
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    await searchCommand.action?.(makeCtx({ type: 'keyword' }));

    expect(written.join('')).not.toContain('Requested --type');
  });

  it('reflects the mismatch in --format json output', async () => {
    vi.doMock('../memory/memory-initializer.js', () => ({
      searchEntries: vi.fn(async () => ({
        success: true,
        results: [],
        searchTime: 1,
        searchMethod: 'hybrid',
      })),
    }));

    const { searchCommand } = await import('../commands/memory-crud.js');
    const written: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      written.push(String(chunk));
      return true;
    });

    await searchCommand.action?.(makeCtx({ type: 'semantic', format: 'json' }));

    const printed = written.join('');
    expect(printed).toContain('"requestedTypeHonored": false');
  });
});
