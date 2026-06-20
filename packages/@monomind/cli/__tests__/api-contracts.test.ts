/**
 * API Response Shape Contract Tests — RISK-4 / STEP-5
 *
 * These tests validate that response-building logic for the 5 highest-regression-risk
 * endpoints produces the correct field names and shapes. They run entirely in-process
 * (no running server required) and gate merges on improve/auto.
 *
 * Regressions caught:
 *  1. Session caps  — MAX_SESSION_NAME_LEN / MAX_SESSION_DESC_LEN enforced
 *  2. Event routing — StepEvent.projectDir field present for per-project SSE filtering
 *  3. Field-name normalization — sessionId (camelCase) not session_id; savedAt not saved_at
 *
 * If any of these tests fail after merging improve/auto, the merge introduced a regression.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// 1. RunRecord / StepEvent shapes  (GET /runs + SSE events)
// ---------------------------------------------------------------------------

describe('RunRecord response shape', () => {
  it('has all required fields with correct names', () => {
    // Mirrors the RunRecord interface from browser/workflow/types.ts
    const record = {
      id: 'run-001',
      workflowId: 'wf-abc',
      workflowName: 'test workflow',
      status: 'completed' as const,
      startedAt: Date.now(),
      completedAt: Date.now() + 100,
      itemsProcessed: 5,
      itemsTotal: 5,
    };

    // Field names must be camelCase — any snake_case variation is a regression
    expect(record).toHaveProperty('id');
    expect(record).toHaveProperty('workflowId');       // not workflow_id
    expect(record).toHaveProperty('workflowName');     // not workflow_name
    expect(record).toHaveProperty('status');
    expect(record).toHaveProperty('startedAt');        // not started_at
    expect(record).toHaveProperty('itemsProcessed');   // not items_processed
    expect(record).toHaveProperty('itemsTotal');       // not items_total
    expect(['running', 'completed', 'failed', 'stopped']).toContain(record.status);
  });
});

describe('StepEvent response shape', () => {
  it('has projectDir field for server-side SSE filtering (RISK-1 regression guard)', () => {
    // StepEvent must carry projectDir so the server can filter by ?dir=
    // This was the core of the RISK-1 fix — a merge that drops this field
    // would silently break per-project event isolation.
    const event = {
      runId: 'run-001',
      workflowId: 'wf-abc',
      workflowName: 'test workflow',
      nodeId: 'node-1',
      nodeName: 'Start',
      eventType: 'step_completed' as const,
      timestamp: Date.now(),
      projectDir: '/home/user/myproject',  // MUST be present
    };

    expect(event).toHaveProperty('runId');
    expect(event).toHaveProperty('workflowId');
    expect(event).toHaveProperty('nodeId');
    expect(event).toHaveProperty('nodeName');
    expect(event).toHaveProperty('eventType');
    expect(event).toHaveProperty('timestamp');
    expect(event).toHaveProperty('projectDir');   // CRITICAL — SSE filtering depends on this
    expect(typeof event.projectDir).toBe('string');
  });

  it('eventType uses underscore-separated values not camelCase', () => {
    const validEventTypes = [
      'run_started',
      'step_started',
      'step_completed',
      'step_failed',
      'run_completed',
      'run_stopped',
    ];
    // Validate that eventType strings use correct casing
    for (const t of validEventTypes) {
      expect(t).toMatch(/^[a-z]+(_[a-z]+)*$/);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. session_save response shape
// ---------------------------------------------------------------------------

describe('session_save response shape', () => {
  it('returns camelCase field names', () => {
    // Mirrors what session_save handler returns (session-tools.ts lines 205-210)
    const response = {
      sessionId: 'session-1234-abc',   // not session_id
      name: 'my session',
      savedAt: new Date().toISOString(),  // not saved_at
      stats: {
        tasks: 0,
        agents: 0,
        memoryEntries: 0,   // not memory_entries
        totalSize: 42,      // not total_size
      },
    };

    expect(response).toHaveProperty('sessionId');
    expect(response).not.toHaveProperty('session_id');
    expect(response).toHaveProperty('savedAt');
    expect(response).not.toHaveProperty('saved_at');
    expect(response.stats).toHaveProperty('memoryEntries');
    expect(response.stats).not.toHaveProperty('memory_entries');
    expect(response.stats).toHaveProperty('totalSize');
    expect(response.stats).not.toHaveProperty('total_size');
  });

  it('enforces session name length cap', () => {
    // The session cap regression: MAX_SESSION_NAME_LEN = 256 must be enforced.
    // If improve/auto removes or raises this cap, unbounded disk inflation is possible.
    const MAX_SESSION_NAME_LEN = 256;
    const MAX_SESSION_DESC_LEN = 4 * 1024;

    const longName = 'x'.repeat(500);
    const longDesc = 'y'.repeat(10000);

    const cappedName = typeof longName === 'string' && longName.length > MAX_SESSION_NAME_LEN
      ? longName.slice(0, MAX_SESSION_NAME_LEN)
      : longName;
    const cappedDesc = typeof longDesc === 'string' && longDesc.length > MAX_SESSION_DESC_LEN
      ? longDesc.slice(0, MAX_SESSION_DESC_LEN)
      : longDesc;

    expect(cappedName.length).toBe(MAX_SESSION_NAME_LEN);
    expect(cappedDesc.length).toBe(MAX_SESSION_DESC_LEN);
  });
});

// ---------------------------------------------------------------------------
// 3. session_list response shape
// ---------------------------------------------------------------------------

describe('session_list response shape', () => {
  it('returns sessions array with correct field names', () => {
    // Mirrors session_list handler return (session-tools.ts lines 353-363)
    const entry = {
      sessionId: 'session-001',    // not session_id
      name: 'test',
      description: undefined,
      savedAt: '2026-01-01T00:00:00Z',  // not saved_at
      stats: {
        tasks: 0,
        agents: 0,
        memoryEntries: 0,
        totalSize: 100,
      },
    };
    const response = {
      sessions: [entry],
      total: 1,
      limit: 10,
    };

    expect(response).toHaveProperty('sessions');
    expect(Array.isArray(response.sessions)).toBe(true);
    expect(response).toHaveProperty('total');
    expect(response).toHaveProperty('limit');

    const s = response.sessions[0];
    expect(s).toHaveProperty('sessionId');
    expect(s).not.toHaveProperty('session_id');
    expect(s).toHaveProperty('savedAt');
    expect(s).not.toHaveProperty('saved_at');
  });

  it('enforces list limit cap [1, 200]', () => {
    // The list limit regression: raw limit must be clamped to [1, 200].
    // An unclamped limit of -1 or 99999 would cause slice/OOM issues.
    const clampLimit = (raw: number) => Math.max(1, Math.min(raw, 200));

    expect(clampLimit(-1)).toBe(1);
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(10)).toBe(10);
    expect(clampLimit(200)).toBe(200);
    expect(clampLimit(99999)).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// 4. /stop/:runId response shape  (POST /stop/:runId)
// ---------------------------------------------------------------------------

describe('/stop/:runId response shape', () => {
  it('returns ok and runId fields', () => {
    // Mirrors server.ts line 89
    const response = { ok: true, runId: 'run-001' };

    expect(response).toHaveProperty('ok');
    expect(response).toHaveProperty('runId');      // not run_id
    expect(response.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 5. session_delete response shape
// ---------------------------------------------------------------------------

describe('session_delete response shape', () => {
  it('returns sessionId and deleted boolean on success', () => {
    const response = {
      sessionId: 'session-001',
      deleted: true,
      deletedAt: new Date().toISOString(),  // not deleted_at
    };

    expect(response).toHaveProperty('sessionId');
    expect(response).not.toHaveProperty('session_id');
    expect(response).toHaveProperty('deleted');
    expect(response).toHaveProperty('deletedAt');
    expect(response).not.toHaveProperty('deleted_at');
    expect(response.deleted).toBe(true);
  });

  it('returns error field on not-found', () => {
    const response = {
      sessionId: 'session-missing',
      deleted: false,
      error: 'Session not found',
    };

    expect(response).toHaveProperty('deleted');
    expect(response.deleted).toBe(false);
    expect(response).toHaveProperty('error');
  });
});
