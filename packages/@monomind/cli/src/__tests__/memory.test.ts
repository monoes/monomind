import { describe, it, expect, vi } from 'vitest';
import type { Command, CommandContext } from '../types.js';

import { storeCommand, retrieveCommand, searchCommand } from '../commands/memory-crud.js';
import { listCommand, editCommand, templatesCommand } from '../commands/memory-list.js';
import { deleteCommand, statsCommand, configureCommand } from '../commands/memory-admin.js';
import { exportCommand, importCommand } from '../commands/memory-transfer.js';
import { memoryCommand } from '../commands/memory.js';

function makeCtx(flags: Record<string, unknown> = {}, args: string[] = []): CommandContext {
  return { args, flags: { _: [], ...flags } as CommandContext['flags'], cwd: process.cwd(), interactive: false };
}

// Mirrors the subcommand-resolution logic in src/index.ts / src/parser.ts:
// match a positional arg against a subcommand's name or one of its aliases.
function resolveSubcommand(name: string): Command | undefined {
  return memoryCommand.subcommands?.find((sc) => sc.name === name || sc.aliases?.includes(name));
}

describe('memoryCommand registration', () => {
  // CLAUDE.md documents "memory | 12" subcommands. Cross-check the actual
  // registered list against what the module wires up.
  it('registers exactly the 12 documented subcommands', () => {
    const names = memoryCommand.subcommands?.map((c) => c.name).sort();
    expect(names).toEqual(
      [
        'configure',
        'delete',
        'edit',
        'export',
        'import',
        'init',
        'list',
        'retrieve',
        'search',
        'stats',
        'store',
        'templates',
      ].sort()
    );
  });

  it('wires each subcommand to the exact handler object exported by its module (not a copy)', () => {
    expect(resolveSubcommand('store')).toBe(storeCommand);
    expect(resolveSubcommand('edit')).toBe(editCommand);
    expect(resolveSubcommand('retrieve')).toBe(retrieveCommand);
    expect(resolveSubcommand('search')).toBe(searchCommand);
    expect(resolveSubcommand('list')).toBe(listCommand);
    expect(resolveSubcommand('delete')).toBe(deleteCommand);
    expect(resolveSubcommand('templates')).toBe(templatesCommand);
    expect(resolveSubcommand('stats')).toBe(statsCommand);
    expect(resolveSubcommand('configure')).toBe(configureCommand);
    expect(resolveSubcommand('export')).toBe(exportCommand);
    expect(resolveSubcommand('import')).toBe(importCommand);
  });

  it('resolves the retrieve subcommand by its "get" alias', () => {
    expect(retrieveCommand.aliases).toContain('get');
    expect(resolveSubcommand('get')).toBe(retrieveCommand);
  });

  it('resolves the list subcommand by its "ls" alias', () => {
    expect(listCommand.aliases).toContain('ls');
    expect(resolveSubcommand('ls')).toBe(listCommand);
  });

  it('has an init subcommand defined inline (not exported from a memory-*.ts submodule)', () => {
    const init = resolveSubcommand('init');
    expect(init).toBeDefined();
    expect(init?.action).toBeTypeOf('function');
    // Not one of the imported handlers — this one lives only in memory.ts.
    expect(init).not.toBe(storeCommand);
    expect(init).not.toBe(listCommand);
  });

  it('does not register anything beyond the 12 documented subcommands', () => {
    expect(memoryCommand.subcommands).toHaveLength(12);
  });
});

describe('memoryCommand dispatch', () => {
  it('routes to the resolved subcommand action and returns its result unmodified', async () => {
    const spy = vi.spyOn(listCommand, 'action').mockResolvedValue({ success: true, data: ['spied'] });
    try {
      const sub = resolveSubcommand('list')!;
      const ctx = makeCtx({ limit: 5 });
      const result = await sub.action!(ctx);
      expect(spy).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({ success: true, data: ['spied'] });
    } finally {
      spy.mockRestore();
    }
  });

  it('routes to searchCommand and returns its result unmodified', async () => {
    const spy = vi.spyOn(searchCommand, 'action').mockResolvedValue({ success: true, data: [{ key: 'x' }] });
    try {
      const sub = resolveSubcommand('search')!;
      const ctx = makeCtx({ query: 'auth patterns' });
      const result = await sub.action!(ctx);
      expect(spy).toHaveBeenCalledWith(ctx);
      expect(result).toEqual({ success: true, data: [{ key: 'x' }] });
    } finally {
      spy.mockRestore();
    }
  });

  it('routes to templatesCommand without crashing on malformed args (unknown type)', async () => {
    const sub = resolveSubcommand('templates')!;
    const result = await sub.action!(makeCtx({ type: 'not-a-real-type' }));
    expect(result?.success).toBe(false);
  });

  it('routes to retrieveCommand without crashing when required args are missing', async () => {
    const spy = vi.spyOn(retrieveCommand, 'action');
    try {
      const sub = resolveSubcommand('retrieve')!;
      const result = await sub.action!(makeCtx({}));
      expect(spy).toHaveBeenCalled();
      expect(result?.success).toBe(false);
      expect(result?.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });

  it('falls through to the top-level help action when no subcommand is given', async () => {
    const result = await memoryCommand.action!(makeCtx({}));
    expect(result?.success).toBe(true);
  });

  it('returns undefined for an unregistered subcommand name', () => {
    expect(resolveSubcommand('does-not-exist')).toBeUndefined();
  });
});
