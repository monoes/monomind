/**
 * Graph engineering playbook improvements #2, #3, #4 — type/schema tests.
 */

import { describe, it, expect } from 'vitest';
import {
  OrgHandoffSchema,
  FailureRoutingSchema,
  type BusEvent,
} from '../../packages/@monomind/cli/src/orgrt/types.js';

describe('OrgHandoff — structured handoff protocol (#2)', () => {
  it('accepts a minimal handoff with only the required nextAction', () => {
    const h = OrgHandoffSchema.parse({
      contextPackage: [],
      artifacts: [],
      decisions: [],
      nextAction: 'review the auth fix',
    });
    expect(h.nextAction).toBe('review the auth fix');
    expect(h.contextPackage).toEqual([]);
  });

  it('accepts a full handoff with context slices, artifacts, and decisions', () => {
    const h = OrgHandoffSchema.parse({
      taskId: 'task-3',
      contextPackage: [
        { source: 'researcher', summary: 'JWT refresh tokens rotate on use' },
        { source: 'src/auth.ts', summary: 'refresh logic lives in rotate()' },
      ],
      artifacts: [
        { path: 'src/auth.ts', description: 'modified refresh path' },
        { path: 'tests/auth.test.ts' },
      ],
      decisions: [{ text: 'rotate on use, not on time', rationale: 'prevents replay' }],
      nextAction: 'run the auth test suite and verify rotation',
    });
    expect(h.taskId).toBe('task-3');
    expect(h.contextPackage).toHaveLength(2);
    expect(h.artifacts).toHaveLength(2);
    expect(h.decisions[0].rationale).toBe('prevents replay');
  });

  it('rejects a handoff missing nextAction', () => {
    expect(() =>
      OrgHandoffSchema.parse({
        contextPackage: [],
        artifacts: [],
        decisions: [],
      }),
    ).toThrow();
  });

  it('rejects a context slice missing source or summary', () => {
    expect(() =>
      OrgHandoffSchema.parse({
        contextPackage: [{ source: 'x' }],
        artifacts: [],
        decisions: [],
        nextAction: 'x',
      }),
    ).toThrow();
  });

  it('serializes to JSON and back losslessly', () => {
    const original = {
      contextPackage: [{ source: 'role-a', summary: 'did X' }],
      artifacts: [{ path: 'f.ts' }],
      decisions: [{ text: 'chose Y' }],
      nextAction: 'do Z',
    };
    const parsed = OrgHandoffSchema.parse(JSON.parse(JSON.stringify(original)));
    expect(parsed).toEqual(original);
  });
});

describe('FailureRouting — per-node failure routing config (#3)', () => {
  it('accepts an empty object (all fields optional)', () => {
    const f = FailureRoutingSchema.parse({});
    expect(f.retry).toBeUndefined();
    expect(f.fallbackAssignee).toBeUndefined();
    expect(f.escalate).toBeUndefined();
  });

  it('accepts a retry policy with custom attempts and backoff schedule', () => {
    const f = FailureRoutingSchema.parse({
      retry: { maxAttempts: 3, backoffMs: [1000, 5000, 15000] },
    });
    expect(f.retry!.maxAttempts).toBe(3);
    expect(f.retry!.backoffMs).toEqual([1000, 5000, 15000]);
  });

  it('accepts a fallback assignee and escalate flag', () => {
    const f = FailureRoutingSchema.parse({
      fallbackAssignee: 'senior-coder',
      escalate: true,
    });
    expect(f.fallbackAssignee).toBe('senior-coder');
    expect(f.escalate).toBe(true);
  });

  it('rejects zero or negative maxAttempts', () => {
    expect(() => FailureRoutingSchema.parse({ retry: { maxAttempts: 0 } })).toThrow();
    expect(() => FailureRoutingSchema.parse({ retry: { maxAttempts: -1 } })).toThrow();
  });

  it('rejects non-string fallbackAssignee', () => {
    expect(() => FailureRoutingSchema.parse({ fallbackAssignee: 123 })).toThrow();
  });
});

describe('BusEvent — graph observability trace type (#4)', () => {
  it('a trace event satisfies the BusEvent type with the new optional fields', () => {
    const e: BusEvent = {
      id: 'run-1-1',
      ts: Date.now(),
      org: 'my-org',
      run: 'run-1',
      type: 'trace',
      from: 'coder',
      traceNodeId: 'task-5',
      traceDurationMs: 4200,
      traceTokensIn: 1200,
      traceTokensOut: 350,
      data: { planned: true },
    };
    expect(e.type).toBe('trace');
    expect(e.traceNodeId).toBe('task-5');
    expect(e.traceDurationMs).toBe(4200);
  });

  it('a message event still satisfies BusEvent without any trace fields', () => {
    const e: BusEvent = {
      id: 'run-1-2',
      ts: Date.now(),
      org: 'my-org',
      run: 'run-1',
      type: 'message',
      from: 'coder',
      to: 'tester',
      msg: 'tests are green',
    };
    expect(e.type).toBe('message');
    expect(e.traceNodeId).toBeUndefined();
  });
});
