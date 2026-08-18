/**
 * org_task_block (see task-dag-block.test.ts / dag-block-task.test.ts) exists
 * and is fully wired, but on a real, long-running org it was never actually
 * used. The boss instead kept leaving a genuinely time-blocked task
 * 'running' forever and manually re-confirming "still scheduled, nothing to
 * do" on every idle-nudge cycle — exactly the wasteful pattern org_task_block
 * was built to eliminate.
 *
 * Root cause: the idle-nudge message — the ONE touchpoint that fires
 * repeatedly, every single idle cycle, and is by far the most salient prompt
 * text a stalled boss actually reads — only ever offered three options
 * (org_complete / reassign via org_send / dispatch next batch via org_task).
 * It never mentioned org_task_block at all. The one-time kickoff briefing and
 * the tool's own description both mention it, but neither is reinforced on
 * every nudge the way this message is, so a boss deep into a long session
 * simply never reached for it.
 *
 * This is prompt-guidance text consumed by an LLM, not executable logic —
 * matching org-complete-scope-guidance.test.ts's approach, this asserts on
 * the source text itself: the idle-nudge message and the org_complete tool
 * description must both point at org_task_block as an explicit option.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const daemonSrc = readFileSync(join(__dirname, '../orgrt/daemon.ts'), 'utf-8');
const sessionSrc = readFileSync(join(__dirname, '../orgrt/session.ts'), 'utf-8');

describe('idle-nudge and org_complete guidance point at org_task_block', () => {
  it('the idle-nudge message offers org_task_block as an explicit numbered option', () => {
    expect(daemonSrc).toMatch(/\(4\) a task is stuck 'running'/);
    expect(daemonSrc).toMatch(
      /do NOT just leave it and re-confirm this every time you get nudged, call org_task_block/,
    );
  });

  it("org_complete's tool description points at org_task_block instead of ending the run for a scheduled blocker", () => {
    expect(sessionSrc).toMatch(/call org_task_block instead of ending the run/);
  });
});
