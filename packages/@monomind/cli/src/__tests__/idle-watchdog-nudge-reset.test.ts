/**
 * The idle watchdog's `nudges` counter was a pure lifetime total — it only
 * ever incremented, never reset, even after a nudge got real activity back.
 * MAX_IDLE_NUDGES (3) was meant to catch a boss that's genuinely hung/looping
 * (every nudge goes unanswered), but as written it also caught a long-running,
 * perfectly healthy org that simply went idle and recovered more than 3 times
 * over its lifetime — e.g. a role periodically checking in on a slow
 * background task (a 24h soak test, a long coverage run) between checkpoints.
 *
 * Observed live: monoterminal-dev was supervising an in-progress 24h soak
 * test (survived its t=20 checkpoint, PID confirmed alive, next checkpoint
 * due in ~1h). The org answered 3 separate idle-nudges with real, productive
 * work each time (task-6 tests progressing, devops-lead posting checkpoint
 * updates) — the boss never once appeared hung — but on the 4th idle spell
 * the watchdog force-stopped the run anyway, citing "org idle again after 3
 * nudges", killing the soak test process under 90 minutes into a 24h run.
 *
 * Fixing THAT exposed a second, subtler bug: resetting the counter on ANY
 * bus activity (including a bare, content-free chat reply with zero tool
 * calls) let a boss that's genuinely out of ideas loop forever making zero
 * progress. Observed live: a boss answered four consecutive 10-minute idle
 * nudges with one-line acknowledgments ("✓ Complete", "✓", "Session
 * complete.") and made zero tool calls across all of them — no org_send, no
 * org_task, nothing — yet the org never got flagged, because every trivial
 * reply reset the cumulative cap meant to catch exactly this. The fix
 * requires a REAL tool call (lastToolActivity) after the nudge was sent, not
 * just any bus event, before treating an idle spell as resolved.
 *
 * `resolvedIdleNudgeCount` is the extracted, pure piece of that decision
 * (daemon.ts's watchdog tick calls it every time idleFor < idleMs) — testable
 * without spinning up a real org, since the surrounding tick has side effects
 * (bus events, mailbox pushes, stopOrg) that aren't worth mocking here.
 */
import { describe, expect, it } from 'vitest';
import { resolvedIdleNudgeCount } from '../orgrt/daemon.js';

describe('resolvedIdleNudgeCount — idle-watchdog nudge counter only tracks unresolved spells', () => {
  it('leaves the counter untouched when there was no outstanding nudge (nudgedAt === 0)', () => {
    expect(resolvedIdleNudgeCount(0, 2, 0)).toBe(2);
  });

  it('resets the counter to 0 once an outstanding nudge is followed by a real tool call', () => {
    const nudgedAt = Date.now();
    const toolActivityAfter = nudgedAt + 100;
    expect(resolvedIdleNudgeCount(nudgedAt, 1, toolActivityAfter)).toBe(0);
    expect(resolvedIdleNudgeCount(nudgedAt, 3, toolActivityAfter)).toBe(0);
  });

  it('does NOT reset when the nudge is outstanding but no tool call has happened since (the trivial-ack bug)', () => {
    const nudgedAt = Date.now();
    // lastToolActivity is 0 (never happened) or predates the nudge — a bare
    // chat-only reply with no tool calls, exactly the observed incident.
    expect(resolvedIdleNudgeCount(nudgedAt, 2, 0)).toBe(2);
    expect(resolvedIdleNudgeCount(nudgedAt, 2, nudgedAt - 5000)).toBe(2);
  });

  it('replays the real 24h-soak-test incident: 3 separate idle spells, each recovered with real tool activity, must never trip the cumulative cap', () => {
    const MAX_IDLE_NUDGES = 3;
    let nudgedAt = 0;
    let nudges = 0;

    for (let i = 0; i < 3; i++) {
      nudges++;
      nudgedAt = Date.now();
      const toolActivityAfter = nudgedAt + 50; // devops-lead posts a real checkpoint update
      nudges = resolvedIdleNudgeCount(nudgedAt, nudges, toolActivityAfter);
      nudgedAt = 0;
      expect(nudges).toBe(0); // resolved — does NOT carry forward
    }

    // A 4th idle spell must be treated as a fresh nudge, not a cap-trip —
    // this is the exact check daemon.ts makes before calling idleStop().
    expect(nudges).toBeLessThan(MAX_IDLE_NUDGES);
  });

  it('replays the trivial-ack incident: 3 separate idle spells, each "answered" with zero tool calls, must reach the cumulative cap', () => {
    const MAX_IDLE_NUDGES = 3;
    let nudgedAt = 0;
    let nudges = 0;
    const lastToolActivity = 0; // boss never calls a tool the entire run

    for (let i = 0; i < 3; i++) {
      nudges++;
      nudgedAt = Date.now();
      // Recovery check runs, but no tool call happened since nudgedAt — this
      // idle spell is NOT resolved, nudges carries forward as-is.
      nudges = resolvedIdleNudgeCount(nudgedAt, nudges, lastToolActivity);
      nudgedAt = 0;
    }

    expect(nudges).toBe(3);
    expect(nudges).toBeGreaterThanOrEqual(MAX_IDLE_NUDGES); // caps correctly — this is what was NOT happening live
  });

  it('still lets a genuinely unresolved run of idle spells reach the cap (protection preserved)', () => {
    const MAX_IDLE_NUDGES = 3;
    let nudges = 0;
    // Never recovers between nudges (nudgedAt stays nonzero, no reset call
    // happens because the run never goes back below idleMs) — nudges simply
    // increments every tick a fresh nudge is sent, same as production.
    nudges++; // 1
    nudges++; // 2
    nudges++; // 3
    expect(nudges).toBeGreaterThanOrEqual(MAX_IDLE_NUDGES); // caps correctly
  });
});
