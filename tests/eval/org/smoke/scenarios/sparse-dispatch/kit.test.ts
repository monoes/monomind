import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OrgDefSchema } from '../../../../../../packages/@monomind/cli/src/orgrt/types.js';
import { checklistFindings } from '../../../../../../packages/@monomind/cli/src/orgrt/validate-checklist.js';
// @ts-expect-error plain .mjs modules
import { checkTrial } from '../../check.mjs';
// @ts-expect-error plain .mjs modules
import { buildInputs, prepareTrial } from '../../prepare.mjs';
// @ts-expect-error plain .mjs modules
import { inboxArgs, planDeliveries, runDriver, ticketMessage } from './driver.mjs';
// @ts-expect-error plain .mjs modules
import * as kit from './kit.mjs';

const CACHE_TTL_SECONDS = 300;
const tmp = () => mkdtempSync(join(tmpdir(), 'sparse-'));
const otherValue = (ledger: Record<string, string>, key: string) =>
  Object.entries(ledger).find(([k]) => k !== key)![1];

describe('ticket schedule', () => {
  it('has 12 tickets in 4 bursts of 3 and a gap above the prompt-cache TTL', async () => {
    const dir = tmp();
    await kit.buildInputs({ dir });
    const truth = JSON.parse(readFileSync(join(dir, 'truth.json'), 'utf8'));
    const schedule = JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf8'));
    expect(truth.tickets).toHaveLength(12);
    expect(truth.tickets.map((t: any) => t.burst)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
    expect(kit.GAP_SECONDS).toBeGreaterThan(CACHE_TTL_SECONDS);
    // the trial's idle watchdog ends a run whose bus is silent for 10 minutes
    expect(kit.GAP_SECONDS).toBeLessThan(600);
    expect(schedule.gapShrunk).toBe(false);
    expect(schedule.bursts.map((b: any) => b.offsetSeconds)).toEqual(
      [0, 1, 2, 3].map((i) => i * kit.GAP_SECONDS),
    );
    expect(schedule.bursts.map((b: any) => b.tickets)).toEqual([
      ['T01', 'T02', 'T03'],
      ['T04', 'T05', 'T06'],
      ['T07', 'T08', 'T09'],
      ['T10', 'T11', 'T12'],
    ]);
  });

  it('shrinks the gap only through SMOKE_GAP_SECONDS, and says so in the schedule', async () => {
    const dir = tmp();
    process.env.SMOKE_GAP_SECONDS = '5';
    try {
      await kit.buildInputs({ dir });
    } finally {
      delete process.env.SMOKE_GAP_SECONDS;
    }
    const schedule = JSON.parse(readFileSync(join(dir, 'schedule.json'), 'utf8'));
    expect(schedule.gapSeconds).toBe(5);
    expect(schedule.gapShrunk).toBe(true);
    expect(schedule.bursts.map((b: any) => b.offsetSeconds)).toEqual([0, 5, 10, 15]);
    process.env.SMOKE_GAP_SECONDS = 'soon';
    try {
      expect(() => kit.gapSeconds()).toThrow(/SMOKE_GAP_SECONDS/);
    } finally {
      delete process.env.SMOKE_GAP_SECONDS;
    }
  });

  it('builds a deterministic 40-entry ledger inside the workspace and the truth outside it', async () => {
    const [a, b] = [tmp(), tmp()];
    await kit.buildInputs({ dir: a });
    await kit.buildInputs({ dir: b });
    const ledger = JSON.parse(readFileSync(join(a, 'workspace/ledger.json'), 'utf8'));
    expect(Object.keys(ledger)).toHaveLength(40);
    expect(new Set(Object.values(ledger)).size).toBe(40);
    expect(readFileSync(join(a, 'workspace/ledger.json'), 'utf8')).toBe(
      readFileSync(join(b, 'workspace/ledger.json'), 'utf8'),
    );
    expect(readFileSync(join(a, 'truth.json'), 'utf8')).toBe(
      readFileSync(join(b, 'truth.json'), 'utf8'),
    );
    expect(() => readFileSync(join(a, 'workspace/truth.json'))).toThrow();
    const truth = JSON.parse(readFileSync(join(a, 'truth.json'), 'utf8'));
    for (const t of truth.tickets) expect(ledger[t.key]).toBeDefined();
    for (const [k, v] of Object.entries(ledger)) expect(String(v)).not.toContain(k.slice(-4));
    const keys = truth.tickets.map((t: any) => t.key);
    // some keys are asked again later, so a rotation that loses state is visible
    expect(new Set(keys).size).toBeLessThan(12);
    expect(new Set(keys).size).toBeGreaterThanOrEqual(8);
  });
});

describe('driver', () => {
  const id = (n: number) => `T${String(n).padStart(2, '0')}`;
  const truth = {
    tickets: Array.from({ length: 12 }, (_, i) => ({
      ticket: id(i + 1),
      key: `acct-${i}`,
      burst: Math.floor(i / 3),
    })),
  };
  const schedule = {
    gapSeconds: 10,
    bursts: [0, 1, 2, 3].map((i) => ({
      index: i,
      offsetSeconds: i * 10,
      tickets: [1, 2, 3].map((j) => id(i * 3 + j)),
    })),
  };

  it('plans every ticket at its burst offset, in order', () => {
    const plan = planDeliveries(schedule, truth);
    expect(plan).toHaveLength(12);
    expect(plan[0]).toMatchObject({ ticket: 'T01', key: 'acct-0', burst: 0, offsetSeconds: 0 });
    expect(plan[11]).toMatchObject({ ticket: 'T12', burst: 3, offsetSeconds: 30 });
    expect(() => planDeliveries(schedule, { tickets: truth.tickets.slice(1) })).toThrow(/T01/);
  });

  it('builds an untagged mail to the steward through org inbox', () => {
    const msg = ticketMessage({ ticket: 'T03', key: 'acct-2' });
    expect(msg.subject).toBe('ticket T03');
    expect(`${msg.subject}${msg.body}`).not.toMatch(/\[task:/);
    expect(msg.body).toContain('T03');
    expect(msg.body).toContain('acct-2');
    const argv = inboxArgs({ cli: '/x/cli.js', org: 'smoke-x', ticket: 'T03', key: 'acct-2' });
    expect(argv.slice(0, 4)).toEqual(['/x/cli.js', 'org', 'inbox', 'smoke-x']);
    expect(argv).toEqual(
      expect.arrayContaining(['--to', 'steward', '--format', 'json', '--from', 'ops:requester']),
    );
    expect(argv[argv.indexOf('--body') + 1]).toBe(msg.body);
    expect(argv[argv.indexOf('--subject') + 1]).toBe(msg.subject);
  });

  it('delivers bursts at their offsets, waits for the org, retries a queued receipt, and logs', async () => {
    const root = tmp();
    let t = 1_000_000;
    const delivered: string[] = [];
    let upCalls = 0;
    let first = true;
    await runDriver({
      root,
      org: 'smoke-x',
      schedule,
      truth,
      isUp: async () => ++upCalls >= 3,
      deliver: async ({ ticket }: { ticket: string }) => {
        if (first) {
          first = false;
          return {
            delivery: 'queued',
            receipt: 'queued for smoke-x:steward (delivered when the org next runs)',
          };
        }
        delivered.push(ticket);
        return { delivery: 'live', receipt: 'delivered' };
      },
      sleep: async (ms: number) => {
        t += ms;
      },
      now: () => t,
    });
    expect(delivered).toEqual(truth.tickets.map((x) => x.ticket));
    expect(upCalls).toBe(3);
    const events = readFileSync(join(root, 'driver-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const sent = events.filter((e) => e.event === 'delivery' && e.ok);
    expect(sent).toHaveLength(12);
    const t0 = events.find((e) => e.event === 'start').tsMs;
    for (const e of sent) {
      expect(e.tsMs - t0).toBeGreaterThanOrEqual(e.scheduledOffsetSeconds * 1000);
      expect(typeof e.ts).toBe('string');
    }
    expect(events.some((e) => e.event === 'delivery' && !e.ok && e.delivery === 'queued')).toBe(
      true,
    );
    expect(events.at(-1).event).toBe('done');
  });

  it('gives up on a ticket the org never accepts and says so', async () => {
    const root = tmp();
    let t = 0;
    await expect(
      runDriver({
        root,
        org: 'smoke-x',
        schedule,
        truth,
        isUp: async () => true,
        deliver: async () => ({
          delivery: 'queued',
          receipt: 'queued for x (delivered when the org next runs)',
        }),
        sleep: async (ms: number) => {
          t += ms;
        },
        now: () => t,
        maxAttempts: 3,
      }),
    ).rejects.toThrow(/T01/);
    const events = readFileSync(join(root, 'driver-events.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(events.filter((e) => e.event === 'delivery')).toHaveLength(3);
    expect(events.at(-1).event).toBe('failed');
  });
});

describe('check', () => {
  const ROT = (ts: number, role = 'steward') => ({
    ts,
    type: 'audit',
    from: role,
    reason: 'session-rotated',
    data: { role, generation: 1 },
  });
  const note = (at: number, kind: string, text: string) =>
    `## ${new Date(at).toISOString()} · ${kind} · ${text.length}\n${text}\n\n`;

  async function setup(contender: 'current-best' | 'phase2') {
    const base = tmp();
    const inputs = await buildInputs({ scenario: 'sparse-dispatch', base });
    const root = await prepareTrial({ scenario: 'sparse-dispatch', base, contender, trial: '1' });
    const truth = JSON.parse(readFileSync(join(inputs, 'truth.json'), 'utf8'));
    const ledger = JSON.parse(readFileSync(join(inputs, 'workspace/ledger.json'), 'utf8'));
    const name = `smoke-sparse-dispatch-${contender}-1`;
    const orgDir = join(root, '.monomind/orgs', name);
    const runDir = join(orgDir, 'run-001');
    mkdirSync(runDir, { recursive: true });
    mkdirSync(join(orgDir, 'notes'), { recursive: true });
    const rows = truth.tickets.map((t: any, i: number) => ({
      ticket: t.ticket,
      key: t.key,
      value: ledger[t.key],
      at: 1_000 + i * 100,
    }));
    const writeAnswers = (r: any[]) =>
      writeFileSync(
        join(root, 'workspace/answers.jsonl'),
        `${r.map((x) => JSON.stringify(x)).join('\n')}\n`,
      );
    const writeBus = (events: any[]) =>
      writeFileSync(join(runDir, 'bus.jsonl'), events.map((e) => JSON.stringify(e)).join('\n'));
    const writeNotes = (text: string) => writeFileSync(join(orgDir, 'notes/steward.md'), text);
    writeAnswers(rows);
    return { root, truth, ledger, rows, writeAnswers, writeBus, writeNotes };
  }
  const answers = (units: any[]) => units.filter((u) => u.unit === 'ticket-answer');
  const notes = (units: any[]) => units.find((u) => u.unit === 'handoff-notes');

  it('accepts exact answers; flags a wrong value, a missing ticket, and a late duplicate', async () => {
    const s = await setup('current-best');
    const good = await checkTrial(s.root);
    expect(answers(good)).toHaveLength(12);
    expect(answers(good).every((u) => u.accepted === true)).toBe(true);
    expect(good.filter((u: any) => u.unit === 'handoff-notes')).toHaveLength(1);

    const rows = s.rows.map((r: any) => ({ ...r }));
    rows[1].value = 'zzzz-zzzz'; // not in the ledger
    rows[4].value = otherValue(s.ledger, rows[4].key); // a ledger value, but the wrong one
    rows.splice(7, 1); // T08 never answered
    rows.push({ ...s.rows[1] }); // T02's correct answer, second: does not rescue it
    s.writeAnswers(rows);
    const units = answers(await checkTrial(s.root));
    const by = (t: string) => units.find((u) => u.evidence.ticket === t);
    expect(by('T02').accepted).toBe(false);
    expect(by('T02').critical).toEqual(['an answer that is not in the ledger']);
    expect(by('T05').accepted).toBe(false);
    expect(by('T05').critical ?? []).toEqual([]);
    expect(by('T08').accepted).toBe(false);
    expect(by('T08').critical).toEqual(['a ticket dropped or never answered']);
    expect(by('T01').accepted).toBe(true);
  });

  it('counts the first answer only, and skips malformed lines', async () => {
    const s = await setup('current-best');
    const lines = [{ ...s.rows[0], value: 'wrong-wrong' }, ...s.rows].map((r) => JSON.stringify(r));
    writeFileSync(join(s.root, 'workspace/answers.jsonl'), `not json\n${lines.join('\n')}\n`);
    const units = answers(await checkTrial(s.root));
    expect(units.find((u) => u.evidence.ticket === 'T01').accepted).toBe(false);
    expect(units.filter((u) => u.accepted)).toHaveLength(11);
  });

  it('flags state lost across a rotation: a key answered right before, wrong after', async () => {
    const s = await setup('phase2');
    const repeat = s.truth.tickets.findIndex(
      (t: any, i: number) => s.truth.tickets.findIndex((u: any) => u.key === t.key) < i,
    );
    const rows = s.rows.map((r: any) => ({ ...r }));
    rows[repeat].value = otherValue(s.ledger, rows[repeat].key);
    s.writeAnswers(rows);
    s.writeBus([ROT(1_000 + repeat * 100 - 50)]);
    const units = answers(await checkTrial(s.root));
    expect(units[repeat].critical).toContain(
      'state lost across a rotation so that a previously answered key is answered wrongly',
    );
  });

  it('is not applicable to the current-best contender (no rotation, no notes)', async () => {
    const s = await setup('current-best');
    const u = notes(await checkTrial(s.root));
    expect(u.accepted).toBeNull();
    expect(u.evidence.notApplicable).toBe(true);
  });

  describe('phase2 notes and rotation evidence', () => {
    it('accepts when a current_state entry was written since the previous rotation and the next answer is right', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(note(1_000, 'current_state', 'T01 done') + note(1_400, 'current_state', 'T05'));
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBe(true);
      expect(u.evidence.rotations).toHaveLength(2);
      expect(
        u.evidence.rotations.every((r: any) => r.noteSincePrevious && r.firstAnswerCorrect),
      ).toBe(true);
    });

    it('accepts plain note entries before each rotation (the old rule rejected this)', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(note(1_000, 'note', 'T01 done') + note(1_400, 'note', 'T05'));
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBe(true);
      expect(u.evidence.currentStateEntries).toBe(0);
      expect(u.evidence.rotations.map((r: any) => r.notesSincePrevious)).toEqual([1, 1]);
    });

    it('rejects a rotation with no note since the previous rotation, even if an older note exists', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(note(1_000, 'current_state', 'T01 done'));
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBe(false);
      expect(u.evidence.rotations[0].noteSincePrevious).toBe(true);
      expect(u.evidence.rotations[1].noteSincePrevious).toBe(false);
      expect(u.evidence.rotations[1].notesSincePrevious).toBe(0);
    });

    it('counts a note of either kind written since the previous rotation', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(
        note(1_000, 'note', 'a') + note(1_300, 'current_state', 'b') + note(1_400, 'note', 'c'),
      );
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBe(true);
      expect(u.evidence.rotations.map((r: any) => r.notesSincePrevious)).toEqual([1, 2]);
      expect(u.evidence.currentStateEntries).toBe(1);
    });

    it('counts notes since the run started for the first rotation', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(note(1_300, 'note', 'only after the first rotation'));
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBe(false);
      expect(u.evidence.rotations[0].noteSincePrevious).toBe(false);
      expect(u.evidence.rotations[1].noteSincePrevious).toBe(true);
    });

    it('rejects a wrong first answer after a rotation, and missing notes', async () => {
      const s = await setup('phase2');
      const rows = s.rows.map((r: any) => ({ ...r }));
      rows[3].value = 'bad-value'; // T04 is the first answer after the rotation at 1250
      s.writeAnswers(rows);
      s.writeBus([ROT(1_250), ROT(1_650)]);
      s.writeNotes(note(1_000, 'current_state', 'a') + note(1_400, 'current_state', 'b'));
      const wrong = notes(await checkTrial(s.root));
      expect(wrong.accepted).toBe(false);
      expect(wrong.evidence.rotations[0].firstAnswerCorrect).toBe(false);
      s.writeNotes('');
      expect(notes(await checkTrial(s.root)).accepted).toBe(false);
    });

    it('leaves a run with fewer than two rotations to review, never guessed', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250)]);
      const u = notes(await checkTrial(s.root));
      expect(u.accepted).toBeNull();
      expect(u.evidence.rotationsRecorded).toBe(1);
    });

    it('ignores other roles rotations', async () => {
      const s = await setup('phase2');
      s.writeBus([ROT(1_250, 'lead')]);
      expect(notes(await checkTrial(s.root)).evidence.rotationsRecorded).toBe(0);
    });
  });
});

describe('prepareTrial', () => {
  it('names the session cap', () => {
    expect(kit.SESSION_CAP).toEqual({ tokens: kit.SESSION_CAP_TOKENS });
    expect(kit.SESSION_CAP_TOKENS).toBeGreaterThan(0);
  });

  it.each(['current-best', 'phase2'])('produces a valid %s definition', async (contender) => {
    const base = tmp();
    await buildInputs({ scenario: 'sparse-dispatch', base });
    const root = await prepareTrial({ scenario: 'sparse-dispatch', base, contender, trial: '1' });
    const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
    const org = JSON.parse(
      readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8'),
    );
    const parsed = OrgDefSchema.parse(org);
    expect(checklistFindings(parsed).errors).toEqual([]);
    expect(trial.driver).toMatch(/driver\.mjs$/);
    expect(trial.allocationUsd).toBe(8);
    expect(trial.deadlineSeconds).toBe(3600);
    expect(org.roles.filter((r: any) => r.reports_to === null).map((r: any) => r.id)).toEqual([
      'lead',
    ]);
    expect(org.roles.find((r: any) => r.id === 'steward').reports_to).toBe('lead');
    if (contender === 'phase2') {
      expect(org.run_config.context).toEqual({
        require_brief: true,
        notes: true,
        session_cap: kit.SESSION_CAP,
      });
    } else {
      expect(org.run_config.context).toBeUndefined();
      expect(trial.effectiveDiffFromCurrentBest).toEqual([]);
    }
  });

  it('gives both contenders identical role text and goal', async () => {
    const base = tmp();
    await buildInputs({ scenario: 'sparse-dispatch', base });
    const defs = [];
    for (const contender of ['current-best', 'phase2']) {
      const root = await prepareTrial({ scenario: 'sparse-dispatch', base, contender, trial: '1' });
      const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
      defs.push(
        JSON.parse(readFileSync(join(root, '.monomind/orgs', `${trial.name}.json`), 'utf8')),
      );
    }
    expect(defs[0].roles).toEqual(defs[1].roles);
    expect(defs[0].goal).toBe(defs[1].goal);
  });
});
