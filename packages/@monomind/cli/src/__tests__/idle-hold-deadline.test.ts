/**
 * ADR-O001 D4 — "continuity is a property of durable state, not of a process".
 *
 * THE INCIDENT (measured): a `monomind-dev` run sat wedged for 8.3 hours. The
 * idle-watchdog record read
 *
 *     {"idle_minutes":60,"idle_stop_at":null,"hold":"pending-question"}
 *
 * A `hold` disables the idle stop entirely — `idle_stop_at: null` means "no
 * deadline, do not nudge, do not stop". The question that set that hold had
 * been declared NON-BLOCKING by its own author, whose text opened with "no
 * answer needed for the run to continue; I am not blocking on this". So a
 * question that said it was not blocking disabled the only mechanism that
 * could have stopped or restarted the run, and nothing moved until a human
 * answered 8.3 hours later. The first turn after the gap cost $17.33 for
 * 7,347 recorded tokens (35x the run's opening rate) because the prompt cache
 * had long expired — the process failure and the cost failure are the same
 * failure.
 *
 * Two structural fixes, both replayed below:
 *   1. blocking-ness is representable on a question, and ONLY a blocking
 *      question may hold the watchdog (`pendingBlockingQuestions`);
 *   2. every hold carries a deadline, so even a blocking one expires and the
 *      run falls back to the normal nudge-then-stop path (`advanceHold`).
 *
 * Plus a no-progress detector (`noProgressRoles`), the equivalent of Gas
 * Town's 30-minutes-hooked-without-progress alarm: during a hold the idle
 * clock says nothing at all, so a role that is nominally working while
 * producing no bus activity has to be surfaced on its own.
 *
 * Same convention as `resolvedIdleNudgeCount` (idle-watchdog-nudge-reset.test.ts):
 * the watchdog tick itself has side effects (bus events, mailbox pushes,
 * stopOrg) that aren't worth mocking, so the decisions are extracted as pure
 * functions and replayed here.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { OrgDaemon } from '../orgrt/daemon.js';
import {
  advanceHold,
  HOLD_TTL_MS,
  NO_PROGRESS_MS,
  noProgressRoles,
  readIdleStatus,
  writeIdleRecord,
} from '../orgrt/idle-deadline.js';
import { askHuman, pendingBlockingQuestions, readQuestions } from '../orgrt/questions.js';

const HOUR = 60 * 60_000;
/** The measured length of the incident. */
const INCIDENT_MS = 8.3 * HOUR;

let root: string;
/** askHuman only touches root / orgs / questionsLocks — no daemon needed. */
function fakeDaemon(): OrgDaemon {
  return { root, orgs: new Map(), questionsLocks: new Map() } as unknown as OrgDaemon;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'idle-hold-'));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('a question that declares itself non-blocking cannot hold the watchdog', () => {
  it('replays the incident: the non-blocking question produces no hold at all', async () => {
    const d = fakeDaemon();
    await askHuman(
      d,
      'monomind-dev',
      'verifier',
      'no answer needed for the run to continue; I am not blocking on this — but was the ' +
        'ADR meant to cover the reviewer split too?',
      false,
    );

    // The question is still pending (unanswered, listed, answerable) …
    expect(readQuestions(root, 'monomind-dev').questions).toHaveLength(1);
    expect(readQuestions(root, 'monomind-dev').questions[0].answer).toBeNull();
    // … but it is NOT a legitimate wait, so the watchdog keeps its deadline
    // and the run stops or recovers on its own. This is the 8.3 hours.
    expect(pendingBlockingQuestions(root, 'monomind-dev')).toHaveLength(0);
  });

  it('still holds for a question that genuinely needs an answer before work continues', async () => {
    const d = fakeDaemon();
    await askHuman(d, 'monomind-dev', 'coder', 'Ship behind a flag or not?', true);
    expect(pendingBlockingQuestions(root, 'monomind-dev')).toHaveLength(1);
  });

  it('treats an unflagged question as blocking (pre-flag records, and callers that omit it)', async () => {
    const d = fakeDaemon();
    await askHuman(d, 'monomind-dev', 'coder', 'Ship behind a flag or not?');
    expect(pendingBlockingQuestions(root, 'monomind-dev')).toHaveLength(1);
  });

  it('drops a question out of the hold set as soon as it is answered', async () => {
    const d = fakeDaemon();
    await askHuman(d, 'monomind-dev', 'coder', 'Ship behind a flag or not?', true);
    const { questions } = readQuestions(root, 'monomind-dev');
    questions[0].answer = 'behind a flag';
    questions[0].answeredAt = Date.now();
    // writeQuestions via the public path the answer flow uses.
    const { writeQuestions } = await import('../orgrt/questions.js');
    writeQuestions(root, 'monomind-dev', { questions });
    expect(pendingBlockingQuestions(root, 'monomind-dev')).toHaveLength(0);
  });
});

describe('every hold carries a deadline', () => {
  it('a live hold always names the instant it stops suppressing the idle clock', () => {
    const t0 = Date.parse('2026-09-18T18:00:00.000Z');
    const { hold } = advanceHold(null, 'pending-question', t0);
    expect(hold).toEqual({
      reason: 'pending-question',
      until: new Date(t0 + HOLD_TTL_MS).toISOString(),
    });
  });

  it('replays the incident: a hold in force for 8.3 hours has long since expired', () => {
    const t0 = Date.parse('2026-09-18T18:00:00.000Z');
    let step = advanceHold(null, 'pending-question', t0);
    expect(step.hold).not.toBeNull(); // legitimate wait, for a while

    // …the human answers 8.3 hours later. Every watchdog tick in between sees
    // the same pending question, so before the fix `hold` stayed set forever
    // and `idle_stop_at` stayed null the whole time.
    step = advanceHold(step.track, 'pending-question', t0 + INCIDENT_MS);
    expect(step.hold).toBeNull(); // the idle clock is running again
    expect(step.expired).toBe('pending-question'); // and it says so, once
    expect(
      advanceHold(step.track, 'pending-question', t0 + INCIDENT_MS + 30_000).expired,
    ).toBeNull();
  });

  it('anchors the deadline to when the reason first appeared, not to each tick', () => {
    const t0 = 1_000_000;
    let step = advanceHold(null, 'pending-question', t0);
    for (let t = t0; t < t0 + HOLD_TTL_MS; t += 30_000)
      step = advanceHold(step.track, 'pending-question', t);
    expect(step.hold).not.toBeNull();
    expect(advanceHold(step.track, 'pending-question', t0 + HOLD_TTL_MS).hold).toBeNull();
  });

  it('restarts the clock when the reason changes — a new wait is a new deadline', () => {
    const t0 = 1_000_000;
    const first = advanceHold(null, 'pending-question', t0);
    const second = advanceHold(first.track, 'pending-approval', t0 + HOLD_TTL_MS - 1);
    expect(second.hold).toEqual({
      reason: 'pending-approval',
      until: new Date(t0 + HOLD_TTL_MS - 1 + HOLD_TTL_MS).toISOString(),
    });
  });

  it('clears the tracker when nothing is holding, so the next wait starts fresh', () => {
    const t0 = 1_000_000;
    const held = advanceHold(null, 'pending-question', t0);
    const free = advanceHold(held.track, null, t0 + 1_000);
    expect(free).toEqual({ track: null, hold: null, expired: null });
    expect(advanceHold(free.track, 'pending-question', t0 + 2_000).hold).not.toBeNull();
  });

  it('surfaces the hold deadline in `org status --json`', () => {
    const until = new Date(Date.now() + HOLD_TTL_MS).toISOString();
    writeIdleRecord(root, 'live', {
      run: 'run-live',
      idle_minutes: 60,
      idle_stop_at: null,
      hold: { reason: 'pending-question', until },
    });
    expect(readIdleStatus(root, 'live', 'run-live')).toMatchObject({
      idle_stop_at: null,
      idle_hold: 'pending-question',
      idle_hold_until: until,
    });
  });

  it('still reads a record written by an older daemon (bare string hold)', () => {
    writeIdleRecord(root, 'live', {
      run: 'run-live',
      idle_minutes: 60,
      idle_stop_at: null,
      hold: 'pending-question' as never,
    });
    expect(readIdleStatus(root, 'live', 'run-live')).toMatchObject({
      idle_hold: 'pending-question',
      idle_hold_until: null,
    });
  });
});

describe('no-progress detector', () => {
  const t = 10 * HOUR;

  it('alarms on a role that is nominally working but has gone silent', () => {
    expect(
      noProgressRoles(
        [{ id: 'coder', working: true, lastActivity: t - NO_PROGRESS_MS, alarmed: false }],
        t,
      ),
    ).toEqual([{ id: 'coder', silentMs: NO_PROGRESS_MS }]);
  });

  it('says nothing about a role that is producing bus activity', () => {
    expect(
      noProgressRoles(
        [{ id: 'coder', working: true, lastActivity: t - 60_000, alarmed: false }],
        t,
      ),
    ).toEqual([]);
  });

  it('says nothing about a role that has ended or crashed — silence is expected there', () => {
    expect(
      noProgressRoles(
        [{ id: 'coder', working: false, lastActivity: t - 4 * HOUR, alarmed: false }],
        t,
      ),
    ).toEqual([]);
  });

  it('alarms once per spell, not on every watchdog tick', () => {
    expect(
      noProgressRoles(
        [{ id: 'coder', working: true, lastActivity: t - 4 * HOUR, alarmed: true }],
        t,
      ),
    ).toEqual([]);
  });
});
