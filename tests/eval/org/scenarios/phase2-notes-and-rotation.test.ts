// Invariants (spec sections 6.8 and 6.10): with a session cap a role's session
// ends between turns once the cap is reached, the next message starts a fresh
// generation whose first message carries a rotation digest and then the role's
// notes, every rotation is audited and recorded, and rotations that finish no
// task in a row put a stall warning in the digest.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { START, startPhase2Org } from '../support/phase2.js';

let started: Awaited<ReturnType<typeof startPhase2Org>> | undefined;
afterEach(async () => {
  await started?.daemon.stopAll();
  started = undefined;
});

const task = (title: string) => ({
  name: 'org_task',
  args: {
    title,
    assignee: 'worker',
    deps: [],
    objective: `Do ${title}`,
    acceptance: `${title} is done`,
  },
});

let calls = 0;
describe('scenario: notes injection, cap rotation and the stall digest', () => {
  it('rotates a role past its cap, hands every new generation a digest then its notes, and warns on a stall', async () => {
    started = await startPhase2Org({
      context: { notes: true, session_cap: { tasks: 1 } },
      runConfig: { session_scope: 'role' },
      script: (role, _turn, message) => {
        if (role === 'boss') {
          const title = /SCENARIO-START (\w+)/.exec(message)?.[1];
          return title ? { tools: [task(title)] } : {};
        }
        // The worker records what it knows once, and never closes a task: no rotation finishes one.
        if (role === 'worker')
          return {
            calls: [{ id: `w${calls++}`, input: 100 }],
            tools:
              calls === 1
                ? [
                    {
                      name: 'org_note_append',
                      args: { text: 'ALPHA-STATE: half done', current_state: true },
                    },
                  ]
                : [],
          };
        return {};
      },
    });
    const worker = () => started!.sdk.messages.get('worker') ?? [];
    await started.poke('boss', START, `${START} Alpha`);
    expect(await started.until(() => worker().length >= 2, 10_000)).toBe(true); // task, then its STILL OPEN reminder in a new generation
    await started.poke('boss', START, `${START} Beta`);
    expect(await started.until(() => worker().some((m) => m.includes('Beta')), 10_000)).toBe(true);
    const seen = worker();

    // Generation 0 has no digest; every later generation starts with one, then the notes, then its message.
    expect(seen[0]).not.toMatch(/session rotation/);
    const later = seen.slice(1);
    expect(later.length).toBeGreaterThanOrEqual(2);
    for (const m of later) {
      expect(m).toMatch(/^You are continuing after a session rotation \(generation \d+\)/);
      expect(m.indexOf('session rotation')).toBeLessThan(m.indexOf('ALPHA-STATE'));
      expect(m.indexOf('ALPHA-STATE')).toBeLessThan(m.indexOf('[task:task-'));
    }
    // One rotation without a finished task is not a stall; two in a row are.
    expect(later[0]).not.toMatch(/rotations in a row/);
    expect(seen.find((m) => m.includes('Beta'))).toMatch(/\d rotations in a row finished no task/);
    expect(new Set(started.sdk.options.get('worker')!.map((o) => o.resume))).toEqual(
      new Set([undefined]),
    );

    // Every rotation is audited with the cap and what crossed it.
    const rotated = started.events.filter(
      (e) => e.reason === 'session-rotated' && e.data?.role === 'worker',
    );
    expect(rotated.map((e) => e.data.generation)).toEqual(rotated.map((_, i) => i + 1));
    expect(rotated[0].data).toMatchObject({ reason: 'tasks', cap: 1, tasks: 1 });

    // The record of each generation's first message is the message the SDK saw.
    const gens = (await started.packetLog()).filter(
      (r) => r.kind === 'generation' && r.role === 'worker',
    );
    expect(gens.map((g: any) => g.first_message_sha256)).toEqual(
      seen.map((m) => createHash('sha256').update(m).digest('hex')),
    );
    expect(gens.slice(1).map((g: any) => g.rotation_generation)).toEqual(
      rotated.map((e) => e.data.generation),
    );
    expect(gens[1]).toMatchObject({ notes_entries: 1 });
  });

  it('does nothing for an org without a session cap or notes', async () => {
    started = await startPhase2Org({
      context: { require_brief: true },
      runConfig: { session_scope: 'role' },
      script: (role, _turn, message) =>
        role === 'boss' && message.includes(START) ? { tools: [task('Alpha'), task('Beta')] } : {},
    });
    await started.poke('boss');
    expect(await started.until(() => (started!.sdk.messages.get('worker') ?? []).length >= 2)).toBe(
      true,
    );
    expect(
      started.sdk.messages
        .get('worker')!
        .every((m) => !/session rotation|notes from earlier/.test(m)),
    ).toBe(true);
    expect(started.events.some((e) => e.reason === 'session-rotated')).toBe(false);
    expect(started.sdk.options.get('worker')).toHaveLength(1); // one session served both tasks
  });
});
