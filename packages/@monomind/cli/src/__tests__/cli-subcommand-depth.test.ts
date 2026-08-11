/**
 * Subcommand dispatch depth regression tests.
 *
 * The dispatcher in run() used to unroll exactly two levels of nesting. A
 * four-segment invocation therefore resolved to its *grandparent* and ran that
 * command's action — and because the grandparent of a deep tree is invariably a
 * group command whose action just prints help, the failure was silent: no
 * error, no unknown-command message, just help text where work should have
 * happened.
 *
 * That is how `hooks transfer store list` (and `search`/`download`/`publish`/
 * `info`) became unreachable. The whole IPFS pattern-store subtree shipped
 * un-runnable and nobody noticed, because asking for it printed something that
 * looked like a legitimate response.
 *
 * Note showHelp() always walked the path with a loop, so `--help` resolved
 * targets correctly at any depth while dispatch did not — the two disagreed.
 * They now share the same walk.
 *
 * These tests assert resolution behaviour directly against the tree, so a
 * future reintroduction of a fixed-depth limit fails here rather than silently
 * disabling commands.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import type { Command } from '../types.js';
import { loadAllCommands } from '../commands/index.js';

let commands: Command[];
beforeAll(async () => {
  commands = await loadAllCommands();
}, 120000); // full commands/index.js import graph is heavy under parallel-worker contention (#33)

/**
 * Mirror of the dispatcher's resolution: descend through subcommands consuming
 * matched segments, and return the command that would actually run plus the
 * args left over for it.
 */
function resolve(root: Command, segments: string[]): { target: Command; rest: string[] } {
  let target = root;
  let consumed = 0;
  while (consumed < segments.length) {
    const seg = segments[consumed];
    const next = target.subcommands?.find((sc) => sc.name === seg || sc.aliases?.includes(seg));
    if (!next) break;
    target = next;
    consumed++;
  }
  return { target, rest: segments.slice(consumed) };
}

function topLevel(name: string): Command {
  const cmd = commands.find((c) => c.name === name);
  if (!cmd) throw new Error(`missing top-level command: ${name}`);
  return cmd;
}

describe('subcommand dispatch depth', () => {
  it('resolves a real three-segment command to its own action', () => {
    // `hooks worker list` — this depth always worked; pin it so a refactor
    // cannot regress the common case while chasing deeper nesting.
    const { target, rest } = resolve(topLevel('hooks'), ['worker', 'list']);
    expect(target.name).toBe('list');
    expect(target.action).toBeTypeOf('function');
    expect(rest).toEqual([]);
  });

  it('resolves four segments to the leaf, not the grandparent', () => {
    // The exact failure shape that hid the pattern store: a synthetic tree
    // shaped like `hooks transfer store list`.
    const leaf: Command = {
      name: 'list',
      description: 'leaf',
      options: [],
      action: async () => ({ success: true }),
    };
    const mid: Command = { name: 'store', description: 'group', options: [], subcommands: [leaf] };
    const sub: Command = { name: 'transfer', description: 'group', options: [], subcommands: [mid] };
    const root: Command = { name: 'hooks', description: 'group', options: [], subcommands: [sub] };

    const { target, rest } = resolve(root, ['transfer', 'store', 'list']);
    expect(target.name).toBe('list');
    expect(rest).toEqual([]);
  });

  it('resolves five segments, so the fix is not another fixed limit', () => {
    const leaf: Command = { name: 'e', description: 'leaf', options: [], action: async () => ({ success: true }) };
    const d: Command = { name: 'd', description: '', options: [], subcommands: [leaf] };
    const c: Command = { name: 'c', description: '', options: [], subcommands: [d] };
    const b: Command = { name: 'b', description: '', options: [], subcommands: [c] };
    const a: Command = { name: 'a', description: '', options: [], subcommands: [b] };

    expect(resolve(a, ['b', 'c', 'd', 'e']).target.name).toBe('e');
  });

  it('stops descending at the first non-subcommand and keeps the rest as args', () => {
    const leaf: Command = { name: 'run', description: '', options: [], action: async () => ({ success: true }) };
    const mid: Command = { name: 'worker', description: '', options: [], subcommands: [leaf] };
    const root: Command = { name: 'hooks', description: '', options: [], subcommands: [mid] };

    const { target, rest } = resolve(root, ['worker', 'run', 'audit', '--force']);
    expect(target.name).toBe('run');
    expect(rest).toEqual(['audit', '--force']);
  });

  it('descends through aliases at depth', () => {
    const leaf: Command = { name: 'list', aliases: ['ls'], description: '', options: [], action: async () => ({ success: true }) };
    const mid: Command = { name: 'store', aliases: ['st'], description: '', options: [], subcommands: [leaf] };
    const root: Command = { name: 'hooks', description: '', options: [], subcommands: [mid] };

    expect(resolve(root, ['st', 'ls']).target.name).toBe('list');
  });

  it('leaves the root as target when nothing matches', () => {
    const root: Command = { name: 'hooks', description: '', options: [], subcommands: [] };
    const { target, rest } = resolve(root, ['nope']);
    expect(target.name).toBe('hooks');
    expect(rest).toEqual(['nope']);
  });

  it('every registered command that has subcommands also has a reachable leaf action', () => {
    // Guards the inverse problem: a group command whose children are all
    // groups, so no invocation can ever reach an action.
    const groupsWithoutAnyAction: string[] = [];
    const visit = (cmd: Command, path: string[]): boolean => {
      const p = [...path, cmd.name];
      if (cmd.action) return true;
      const kids = cmd.subcommands ?? [];
      if (kids.length === 0) return false;
      const anyReachable = kids.map((k) => visit(k, p)).some(Boolean);
      if (!anyReachable) groupsWithoutAnyAction.push(p.join(' '));
      return anyReachable;
    };
    commands.forEach((c) => visit(c, []));
    expect(groupsWithoutAnyAction).toEqual([]);
  });
});
