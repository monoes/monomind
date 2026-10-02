// Invariants (spec sections 6.8, 9): in an org on the context surface a task
// without its required brief fields is rejected and never created, an oversize
// packet is rejected and never truncated, and a result over 1,000 characters is
// rejected with the task left open. A rejection costs no model call of its own.
import { afterEach, describe, expect, it } from 'vitest';
import {
  MAX_PACKET_CHARS,
  MAX_REFERENCES,
} from '../../../../packages/@monomind/cli/src/orgrt/packet.js';
import { START, startPhase2Org, taskIdOf } from '../support/phase2.js';

let started: Awaited<ReturnType<typeof startPhase2Org>> | undefined;
afterEach(async () => {
  await started?.daemon.stopAll();
  started = undefined;
});

const complete = { objective: 'Draft the post', acceptance: 'A reviewer can publish it unedited' };

describe('scenario: briefs, packet bounds and summary returns', () => {
  it('rejects a task missing a required brief field, creates none, and accepts the complete one', async () => {
    started = await startPhase2Org({
      context: { require_brief: true },
      script: (role, _turn, message) =>
        role === 'boss' && message.includes(START)
          ? {
              tools: [
                {
                  name: 'org_task',
                  args: {
                    title: 'No acceptance',
                    assignee: 'worker',
                    deps: [],
                    objective: 'Do it',
                  },
                },
                {
                  name: 'org_task',
                  args: { title: 'Complete', assignee: 'worker', deps: [], ...complete },
                },
              ],
            }
          : {},
    });
    await started.poke('boss');
    expect(await started.until(() => started!.sdk.toolResults.length === 2)).toBe(true);
    const [rejected, accepted] = started.sdk.toolResults.map((r) => r.json);
    expect(rejected.error).toMatch(/acceptance/);
    expect(rejected.taskId ?? rejected.id).toBeUndefined();
    expect(accepted.error).toBeUndefined();
    // Only the complete task reached the worker, with the fields rendered into its brief.
    expect(await started.until(() => (started!.sdk.messages.get('worker') ?? []).length >= 1)).toBe(
      true,
    );
    const received = started.sdk.messages.get('worker')!;
    expect(received).toHaveLength(1);
    expect(received[0]).toContain('Complete');
    expect(received[0]).toContain('A reviewer can publish it unedited');
  });

  it('rejects a packet over its limits instead of cutting it, and records the one it accepts', async () => {
    started = await startPhase2Org({
      context: { notes: true },
      script: (role, _turn, message) =>
        role === 'boss' && message.includes(START)
          ? {
              tools: [
                {
                  name: 'org_task',
                  args: {
                    title: 'Too many refs',
                    assignee: 'worker',
                    deps: [],
                    ...complete,
                    references: {
                      files: Array.from({ length: MAX_REFERENCES + 1 }, (_, i) => `/f/${i}`),
                    },
                  },
                },
                {
                  name: 'org_task',
                  args: {
                    title: 'Too long',
                    assignee: 'worker',
                    deps: [],
                    ...complete,
                    brief: 'b'.repeat(MAX_PACKET_CHARS),
                  },
                },
                {
                  name: 'org_task',
                  args: {
                    title: 'Fits',
                    assignee: 'worker',
                    deps: [],
                    ...complete,
                    references: { files: ['/repo/README.md'] },
                  },
                },
              ],
            }
          : {},
    });
    await started.poke('boss');
    expect(await started.until(() => started!.sdk.toolResults.length === 3)).toBe(true);
    const [refs, long, fits] = started.sdk.toolResults.map((r) => r.json);
    expect(refs.error).toMatch(/references/);
    expect(long.error).toMatch(/12000|12,000|brief/i);
    expect(fits.error).toBeUndefined();

    expect(await started.until(() => (started!.sdk.messages.get('worker') ?? []).length >= 1)).toBe(
      true,
    );
    expect(started.sdk.messages.get('worker')![0]).toContain('/repo/README.md');
    const log = await started.packetLog();
    const packets = log.filter((r) => r.kind === 'packet');
    expect(packets).toHaveLength(1); // the rejected ones were never dispatched
    const gens = log.filter((r) => r.kind === 'generation' && r.role === 'worker');
    expect(gens).toHaveLength(1);
  });

  it('rejects a result over 1,000 characters, leaves the task open, and accepts a summary', async () => {
    started = await startPhase2Org({
      context: { notes: true },
      script: (role, _turn, message) => {
        if (role === 'boss' && message.includes(START))
          return {
            tools: [
              {
                name: 'org_task',
                args: { title: 'Write it', assignee: 'worker', deps: [], ...complete },
              },
            ],
          };
        const id = taskIdOf(message);
        if (role === 'worker' && id)
          return {
            tools: [
              { name: 'org_task_done', args: { taskId: id, result: 'r'.repeat(1001) } },
              { name: 'org_task_done', args: { taskId: id, result: 'Done: /repo/post.md' } },
            ],
          };
        return {};
      },
    });
    await started.poke('boss');
    expect(
      await started.until(
        () => started!.sdk.toolResults.filter((r) => r.name === 'org_task_done').length === 2,
      ),
    ).toBe(true);
    const [long, short] = started.sdk.toolResults.filter((r) => r.name === 'org_task_done');
    expect(long.json.error).toMatch(/1001 characters.*1000/);
    expect(short.json.error).toBeUndefined();
  });
});
