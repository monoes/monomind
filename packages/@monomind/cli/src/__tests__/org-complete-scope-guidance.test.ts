/**
 * Structural bug: a long-horizon, multi-phase org (e.g. "build, test, and
 * ship a whole product across Phase 1-4") called org_complete with outcome
 * "achieved" the moment its CURRENT batch of dispatched tasks finished —
 * even though the org's actual stated goal (the full multi-month roadmap)
 * was nowhere near done. Root cause: the idle-watchdog nudge offered the
 * boss only a binary choice — "call org_complete" or "reassign stalled
 * work" — with no third option for "nothing's stalled, but the goal has
 * more scope left, so dispatch the next batch instead." Combined with
 * org_complete's and the kickoff briefing's ambiguous "goal is achieved"
 * wording (never distinguishing "this batch" from "the org's full goal"),
 * the boss had no textual signal steering it away from over-eagerly ending
 * a run that still had real scope remaining.
 *
 * This is prompt-guidance text consumed by an LLM, not executable logic —
 * there's no way to behaviorally test "does the model actually behave
 * differently" without a real LLM call, so this asserts on the source text
 * itself: the three fixed locations must (a) distinguish "this batch" from
 * "the full stated goal", and (b) the idle-nudge must offer dispatching
 * more work as an explicit third option alongside complete/reassign.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonSrc = readFileSync(join(__dirname, '../orgrt/daemon.ts'), 'utf-8');
const sessionSrc = readFileSync(join(__dirname, '../orgrt/session.ts'), 'utf-8');

describe('org_complete scope guidance distinguishes "this batch" from "the full goal"', () => {
  it('org_complete tool description warns against calling it for just the current batch', () => {
    expect(sessionSrc).toMatch(/never against just the current batch of dispatched tasks/);
    expect(sessionSrc).toMatch(/use org_task\/createTask to dispatch the next phase/);
  });

  it('the kickoff briefing distinguishes the full goal from a finished batch', () => {
    expect(daemonSrc).toMatch(/not merely "this batch of dispatched tasks finished"/);
    expect(daemonSrc).toMatch(/dispatch the next batch instead of ending the run/);
  });

  it('the idle-nudge offers dispatching more work as a real third option, not just complete-or-reassign', () => {
    expect(daemonSrc).toMatch(/pick ONE:/);
    expect(daemonSrc).toMatch(
      /do NOT call org_complete for this case, instead dispatch the next batch/,
    );
  });
});
