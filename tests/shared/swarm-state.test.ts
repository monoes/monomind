/**
 * Tests for Task 20: TypedDict Swarm State with Reducer Annotations
 * Uses vitest globals (describe, it, expect)
 */
import { describe, it, expect } from 'vitest';

import {
  appendReducer,
  lastWriteReducer,
  mergeUniqueReducer,
  deepMergeReducer,
  raftMergeReducer,
} from '../../packages/@monobrain/shared/src/reducers.js';
import { StateManager } from '../../packages/@monobrain/shared/src/state-manager.js';
import { validateSwarmState, createDefaultSwarmState } from '../../packages/@monobrain/shared/src/swarm-state.js';
import { validateSwarmState as validateFn } from '../../packages/@monobrain/shared/src/state-validator.js';
import type { Finding, ConsensusVote } from '../../packages/@monobrain/shared/src/swarm-state.js';

// ---------------------------------------------------------------------------
// Reducer unit tests
// ---------------------------------------------------------------------------

describe('appendReducer', () => {
  it('concatenates two arrays', () => {
    expect(appendReducer([1, 2], [3, 4])).toEqual([1, 2, 3, 4]);
  });

  it('handles empty arrays', () => {
    expect(appendReducer([], [1])).toEqual([1]);
    expect(appendReducer([1], [])).toEqual([1]);
    expect(appendReducer([], [])).toEqual([]);
  });
});

describe('lastWriteReducer', () => {
  it('returns the second value', () => {
    expect(lastWriteReducer('old', 'new')).toBe('new');
    expect(lastWriteReducer(42, 99)).toBe(99);
  });
});

describe('mergeUniqueReducer', () => {
  it('deduplicates primitives', () => {
    const result = mergeUniqueReducer([1, 2, 3], [2, 3, 4]);
    expect(result).toEqual([1, 2, 3, 4]);
  });

  it('deduplicates objects by key', () => {
    const a = [{ id: 'a', name: 'Alice' }, { id: 'b', name: 'Bob' }];
    const b = [{ id: 'b', name: 'Bobby' }, { id: 'c', name: 'Charlie' }];
    const result = mergeUniqueReducer(a, b, 'id');
    expect(result).toHaveLength(3);
    expect(result.find((x) => x.id === 'b')!.name).toBe('Bobby');
  });
});

describe('deepMergeReducer', () => {
  it('deeply merges nested objects', () => {
    const a = { x: { y: 1, z: 2 }, w: 10 };
    const b = { x: { y: 99 } };
    const result = deepMergeReducer(
      a as Record<string, unknown>,
      b as Record<string, unknown>,
    );
    expect(result).toEqual({ x: { y: 99, z: 2 }, w: 10 });
  });

  it('second value wins for non-objects', () => {
    const a = { x: 'old', arr: [1, 2] };
    const b = { x: 'new', arr: [3] };
    const result = deepMergeReducer(
      a as Record<string, unknown>,
      b as Record<string, unknown>,
    );
    expect(result.x).toBe('new');
    expect(result.arr).toEqual([3]);
  });
});

describe('raftMergeReducer', () => {
  it('higher term wins', () => {
    const low: ConsensusVote = {
      protocol: 'raft',
      term: 1,
      votes: [],
      committed: false,
    };
    const high: ConsensusVote = {
      protocol: 'raft',
      term: 5,
      votes: [],
      committed: false,
    };
    expect(raftMergeReducer(low, high)).toBe(high);
    expect(raftMergeReducer(high, low)).toBe(high);
  });

  it('committed wins when terms are equal', () => {
    const uncommitted: ConsensusVote = {
      protocol: 'raft',
      term: 3,
      votes: [],
      committed: false,
    };
    const committed: ConsensusVote = {
      protocol: 'raft',
      term: 3,
      votes: [],
      committed: true,
    };
    expect(raftMergeReducer(uncommitted, committed)).toBe(committed);
    expect(raftMergeReducer(committed, uncommitted)).toBe(committed);
  });

  it('returns non-null when one side is null', () => {
    const vote: ConsensusVote = {
      protocol: 'raft',
      term: 1,
      votes: [],
      committed: false,
    };
    expect(raftMergeReducer(null, vote)).toBe(vote);
    expect(raftMergeReducer(vote, null)).toBe(vote);
  });
});

// ---------------------------------------------------------------------------
// StateManager tests
// ---------------------------------------------------------------------------

describe('StateManager', () => {
  it('correctly appends 10 parallel writes to findings', async () => {
    const mgr = new StateManager();
    const writes = Array.from({ length: 10 }, (_, i): Finding => ({
      agentSlug: `agent-${i}`,
      taskId: `task-${i}`,
      severity: 'medium',
      description: `finding ${i}`,
    }));

    await Promise.all(
      writes.map((f) => mgr.write('findings', [f], f.agentSlug)),
    );

    const findings = mgr.read('findings') as Finding[];
    expect(findings).toHaveLength(10);
    // Verify all 10 agents are represented
    const slugs = new Set(findings.map((f) => f.agentSlug));
    expect(slugs.size).toBe(10);
  });

  it('does not lose writes under concurrent pressure (metadata deep merge)', async () => {
    const mgr = new StateManager();
    const keys = Array.from({ length: 20 }, (_, i) => `key-${i}`);

    await Promise.all(
      keys.map((k) =>
        mgr.write('metadata', { [k]: true }, 'agent'),
      ),
    );

    const meta = mgr.read('metadata') as Record<string, unknown>;
    for (const k of keys) {
      expect(meta[k]).toBe(true);
    }
  });

  it('snapshot returns a frozen copy', () => {
    const mgr = new StateManager();
    const snap = mgr.snapshot();
    expect(Object.isFrozen(snap)).toBe(true);
    expect(Object.isFrozen(snap.messages)).toBe(true);
    expect(Object.isFrozen(snap.messages.value)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Validator tests
// ---------------------------------------------------------------------------

describe('validateSwarmState', () => {
  it('detects missing required keys', () => {
    const partial = { messages: createDefaultSwarmState().messages };
    const result = validateFn(partial, ['messages', 'findings', 'consensus']);
    expect(result.valid).toBe(false);
    expect(result.errors).toHaveLength(2);
    const missingKeys = result.errors.map((e) => e.key);
    expect(missingKeys).toContain('findings');
    expect(missingKeys).toContain('consensus');
  });

  it('returns valid for a complete state', () => {
    const state = createDefaultSwarmState();
    const result = validateFn(state, [
      'messages',
      'findings',
      'errors',
      'consensus',
      'metadata',
      'taskResults',
    ]);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
