/**
 * `monomind doc search`'s KG-triplet fusion built its result objects as
 * `{ id: <synthetic kg:<i>:<source>|<relation>|<target> key>, kind: 'triplet',
 * ...t }` — spreading the raw triplet AFTER the explicit `id`/`kind` fields
 * silently let the triplet's OWN `id` (its bridge-entry id, a completely
 * different id namespace) win, defeating the synthetic key the surrounding
 * code clearly intended (TS2783 flagged this as a real compile error: "'id'
 * is specified more than once, so this usage will be overwritten").
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Command, CommandContext, CommandResult } from '../types.js';

vi.mock('../memory/memory-kg.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../memory/memory-kg.js')>();
  return {
    ...actual,
    kgSearch: vi.fn(async () => ({
      success: true,
      context: 'stub',
      triplets: [
        {
          source: 'A',
          relation: 'relates_to',
          target: 'B',
          fact: 'A relates_to B',
          score: 0.9,
          // Deliberately a totally different id namespace than the
          // synthetic `kg:0:A|relates_to|B` key doc.ts constructs — this is
          // exactly the collision that silently won before the fix.
          id: 'entry_raw_bridge_id_12345',
          key: 'e:deadbeef',
        },
      ],
      seeds: [],
    })),
  };
});
vi.mock('../knowledge/document-pipeline.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../knowledge/document-pipeline.js')>();
  return { ...actual, searchKnowledge: vi.fn(async () => []) };
});

const { docCommand } = await import('../commands/doc.js');

const sub = (name: string): Command => {
  const cmd = docCommand.subcommands?.find((c) => c.name === name);
  if (!cmd) throw new Error(`doc ${name} subcommand is not registered`);
  return cmd;
};

const ORIGINAL_CWD = process.cwd();

beforeAll(() => {
  // The 'kg' surface routes through query-router.js's rrfFuse - no real
  // store/cwd side effects for this test since kgSearch is mocked above.
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
  vi.restoreAllMocks();
});

describe('doc search - KG triplet fusion preserves the synthetic id, not the raw triplet id', () => {
  it('uses the synthetic "kg:<index>:<source>|<relation>|<target>" id, not the triplet\'s own bridge-entry id', async () => {
    const ctx: CommandContext = {
      args: [],
      flags: { query: 'A relates_to B', surfaces: 'kg', _: [] } as CommandContext['flags'],
      cwd: ORIGINAL_CWD,
      interactive: false,
    };
    const result: CommandResult | undefined = await sub('search').action?.(ctx);
    expect(result?.success).toBe(true);
    const data = result?.data as Array<{ id: string; kind: string }>;
    expect(data).toHaveLength(1);
    expect(data[0].kind).toBe('triplet');
    expect(data[0].id).toBe('kg:0:A|relates_to|B');
    expect(data[0].id).not.toBe('entry_raw_bridge_id_12345');
  });
});
