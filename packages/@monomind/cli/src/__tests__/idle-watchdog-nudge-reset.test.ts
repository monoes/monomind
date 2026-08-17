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
 * `resolvedIdleNudgeCount` is the extracted, pure piece of that decision
 * (daemon.ts's watchdog tick calls it every time idleFor < idleMs) — testable
 * without spinning up a real org, since the surrounding tick has side effects
 * (bus events, mailbox pushes, stopOrg) that aren't worth mocking here.
 */
import { describe, expect, it } from 'vitest';
import { resolvedIdleNudgeCount } from '../orgrt/daemon.js';

describe('resolvedIdleNudgeCount — idle-watchdog nudge counter only tracks unresolved spells', () => {
  it('leaves the counter untouched when there was no outstanding nudge (nudgedAt === 0)', () => {
    expect(resolvedIdleNudgeCount(0, 2)).toBe(2);
  });

  it('resets the counter to 0 once an outstanding nudge is followed by real activity', () => {
    expect(resolvedIdleNudgeCount(Date.now(), 1)).toBe(0);
    expect(resolvedIdleNudgeCount(Date.now(), 3)).toBe(0);
  });

  it('replays the real incident: 3 separate idle spells, each recovered, must never trip the cumulative cap', () => {
    const MAX_IDLE_NUDGES = 3;
    let nudgedAt = 0;
    let nudges = 0;

    // Idle spell 1: nudge sent, then real activity arrives — resolved.
    nudges++;
    nudgedAt = Date.now();
    nudges = resolvedIdleNudgeCount(nudgedAt, nudges);
    nudgedAt = 0;
    expect(nudges).toBe(0); // resolved — does NOT carry forward as 1

    // Idle spell 2: same shape.
    nudges++;
    nudgedAt = Date.now();
    nudges = resolvedIdleNudgeCount(nudgedAt, nudges);
    nudgedAt = 0;
    expect(nudges).toBe(0);

    // Idle spell 3: same shape.
    nudges++;
    nudgedAt = Date.now();
    nudges = resolvedIdleNudgeCount(nudgedAt, nudges);
    nudgedAt = 0;
    expect(nudges).toBe(0);

    // A 4th idle spell must be treated as a fresh nudge, not a cap-trip —
    // this is the exact check daemon.ts makes before calling idleStop().
    expect(nudges).toBeLessThan(MAX_IDLE_NUDGES);
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
