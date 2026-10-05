// packages/@monomind/cli/__tests__/orgrt/notes.test.ts
//
// Org sections spec 6.10, Phase 2: notes. A role appends to its own notes file
// with org_note_append (append-only; curation is a new "current state" entry
// that supersedes older ones), and a fresh session starts with the last
// current state plus the later appends, within a 4,000-char budget that also
// respects the 12,000-char limit on the first message's variable parts.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../../src/__tests__/tmp-track.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { OrgDaemon } from '../../src/orgrt/daemon.js';
import { dagCreateTask } from '../../src/orgrt/decisions.js';
import { appendNote, MAX_NOTE_CHARS, NOTES_BUDGET, notesPath, readNotes, selectNotes } from '../../src/orgrt/notes.js';
import { setOrgSignatureEnforcement } from '../../src/orgrt/org-signature-enforcement.js';
import { readPacketLog } from '../../src/orgrt/packet.js';
import { buildOrgTools, type SessionOpts } from '../../src/orgrt/session.js';
import { OrgDefSchema, type OrgRole } from '../../src/orgrt/types.js';
import type { OrgBus } from '../../src/orgrt/bus.js';
import type { Mailbox } from '../../src/orgrt/mailbox.js';
import type { PolicyEngine } from '../../src/orgrt/policy.js';

const dir = () => mkdtempSync(join(tmpdir(), 'notes-'));

describe('the notes file', () => {
  it('lives at <orgDir>/notes/<role>.md, and a role id cannot escape the directory', () => {
    expect(notesPath('/o', 'worker')).toBe('/o/notes/worker.md');
    expect(notesPath('/o', '../../etc/passwd')).toBe('/o/notes/.._.._etc_passwd.md');
  });

  it('appends entries in order and never rewrites an earlier one', () => {
    const o = dir();
    appendNote(o, 'w', 'first', 'note', new Date('2026-10-02T10:00:00Z'));
    const before = readFileSync(notesPath(o, 'w'), 'utf8');
    appendNote(o, 'w', 'second', 'current_state', new Date('2026-10-02T11:00:00Z'));
    expect(readFileSync(notesPath(o, 'w'), 'utf8').startsWith(before)).toBe(true);
    const entries = readNotes(o, 'w');
    expect(entries.map((e) => [e.kind, e.text])).toEqual([['note', 'first'], ['current_state', 'second']]);
    expect(entries[1].at).toBe('2026-10-02T11:00:00.000Z');
  });

  it('keeps an entry whose text looks like a header as part of that entry', () => {
    const o = dir();
    appendNote(o, 'w', 'line one\n## 2026-01-01T00:00:00.000Z · note\nnot a new entry', 'note');
    expect(readNotes(o, 'w')).toHaveLength(1);
    expect(readNotes(o, 'w')[0].text).toContain('not a new entry');
  });

  it('reads a missing file as no entries', () => {
    expect(readNotes(dir(), 'w')).toEqual([]);
  });

  it('rejects an empty entry and one over the limit, writing nothing', () => {
    const o = dir();
    expect(() => appendNote(o, 'w', '   ', 'note')).toThrow(/empty/);
    expect(() => appendNote(o, 'w', 'x'.repeat(MAX_NOTE_CHARS + 1), 'note')).toThrow(new RegExp(`over ${MAX_NOTE_CHARS}`));
    expect(existsSync(notesPath(o, 'w'))).toBe(false);
  });
});

describe('selectNotes', () => {
  const e = (n: number, kind: 'note' | 'current_state', size = 100) => ({ at: `2026-10-02T10:0${n}:00.000Z`, kind, text: `${n}`.repeat(size) });

  it('takes the last current state and the appends after it, oldest first', () => {
    const sel = selectNotes([e(1, 'note'), e(2, 'current_state'), e(3, 'note'), e(4, 'note')], NOTES_BUDGET);
    expect(sel.included.map((x) => x.text[0])).toEqual(['2', '3', '4']);
    expect(sel.omitted).toBe(1);
  });

  it('without a current state takes the most recent entries that fit, never a partial one', () => {
    const sel = selectNotes([e(1, 'note', 300), e(2, 'note', 300), e(3, 'note', 300)], 800);
    expect(sel.included.map((x) => x.text[0])).toEqual(['2', '3']);
    expect(sel.block.length).toBeLessThanOrEqual(800);
    expect(sel.omitted).toBe(1);
  });

  it('drops the oldest appends first when the budget is tight, keeping the current state', () => {
    const sel = selectNotes([e(1, 'current_state', 200), e(2, 'note', 200), e(3, 'note', 200)], 700);
    expect(sel.included.map((x) => x.text[0])).toEqual(['1', '3']);
  });

  it('includes nothing, and says why, when even the newest entry does not fit', () => {
    const sel = selectNotes([e(1, 'note', 900)], 400);
    expect(sel.included).toEqual([]);
    expect(sel.block).toBe('');
    expect(sel.omitted).toBe(1);
  });

  it('is empty with no entries or no budget', () => {
    expect(selectNotes([], NOTES_BUDGET).block).toBe('');
    expect(selectNotes([e(1, 'note')], 0).block).toBe('');
  });

  it('never exceeds its budget, header included', () => {
    for (const budget of [100, 400, 1000, 4000]) {
      const sel = selectNotes([e(1, 'current_state', 150), e(2, 'note', 90), e(3, 'note', 220), e(4, 'note', 60)], budget);
      expect(sel.block.length).toBeLessThanOrEqual(budget);
    }
  });
});

const def = (context?: unknown) =>
  OrgDefSchema.parse({
    name: 'o', goal: 'g', run_config: context === undefined ? {} : { context },
    roles: [{ id: 'boss', title: 'B', type: 'boss' }, { id: 'dev', title: 'D', type: 'd', reports_to: 'boss' }],
  });
const tools = (context: unknown, orgDir: string) =>
  buildOrgTools({
    org: 'o', role: { id: 'dev' } as OrgRole, def: def(context), bus: {} as OrgBus, policy: {} as PolicyEngine,
    mailbox: {} as Mailbox, cwd: '/work', orgDir, deliver: async () => 'ok',
  } as SessionOpts);

describe('org_note_append', () => {
  it('is registered only with notes: true', () => {
    const o = dir();
    expect(tools(undefined, o).some((t) => t.name === 'org_note_append')).toBe(false);
    expect(tools({ require_brief: true }, o).some((t) => t.name === 'org_note_append')).toBe(false);
    expect(tools({ notes: false, session_cap: { tasks: 5 } }, o).some((t) => t.name === 'org_note_append')).toBe(false);
    expect(tools({ notes: true }, o).some((t) => t.name === 'org_note_append')).toBe(true);
  });

  it('appends to the calling role\'s own file and reports what it holds', async () => {
    const o = dir();
    const t = tools({ notes: true }, o).find((x) => x.name === 'org_note_append')!;
    const a = JSON.parse((await t.handler({ text: 'found the cause' })).text);
    const b = JSON.parse((await t.handler({ text: 'state: done with A', current_state: true })).text);
    expect(a).toMatchObject({ ok: true, entries: 1 });
    expect(b).toMatchObject({ ok: true, entries: 2 });
    expect(readNotes(o, 'dev').map((x) => x.kind)).toEqual(['note', 'current_state']);
    expect(existsSync(notesPath(o, 'boss'))).toBe(false); // another role's file is never touched
  });

  it('rejects an empty or over-long entry with a reason and writes nothing', async () => {
    const o = dir();
    const t = tools({ notes: true }, o).find((x) => x.name === 'org_note_append')!;
    expect(JSON.parse((await t.handler({ text: ' ' })).text).error).toMatch(/empty/);
    expect(JSON.parse((await t.handler({ text: 'x'.repeat(MAX_NOTE_CHARS + 1) })).text).error).toMatch(/over/);
    expect(readNotes(o, 'dev')).toEqual([]);
  });
});

// --- injection into a fresh session's first message, through a real daemon -------------------

let daemon: OrgDaemon | undefined;
afterEach(async () => {
  await daemon?.stopAll();
  daemon = undefined;
});

async function waitUntil(pred: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

async function noteOrg(context: unknown, seed?: (orgDir: string) => void) {
  setOrgSignatureEnforcement(false);
  const root = mkdtempSync(join(tmpdir(), 'notes-inject-'));
  mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
  writeFileSync(
    join(root, '.monomind/orgs/o.json'),
    JSON.stringify({
      name: 'o', goal: 'g', run_config: { session_scope: 'task', ...(context === undefined ? {} : { context }) },
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }, { id: 'dev', title: 'D', type: 'specialist', reports_to: 'boss' }],
    }),
  );
  seed?.(join(root, '.monomind/orgs/o'));
  const first: string[] = [];
  const queryFn = (({ prompt, options }: any) => {
    const role = /You are agent "([^"]+)"/.exec(options.systemPrompt)?.[1];
    return (async function* () {
      let seen = false;
      for await (const m of prompt) {
        if (role === 'dev' && !seen) first.push(String(m.message.content));
        seen = true;
        yield { type: 'result', subtype: 'success', session_id: `sdk-${role}`, usage: { input_tokens: 0, output_tokens: 0 }, total_cost_usd: 0 };
      }
    })();
  }) as never;
  daemon = new OrgDaemon(root, { queryFn, forward: false, stopWaitMs: 100, crashBackoffsMs: [] });
  const running = await daemon.startOrg('o');
  return { running, first };
}

describe('notes in the first message of a fresh session', () => {
  it('starts the session with the role\'s notes ahead of the task, and records exactly that message', async () => {
    const { running, first } = await noteOrg({ notes: true }, (o) => {
      appendNote(o, 'dev', 'old finding', 'note');
      appendNote(o, 'dev', 'CURRENT: listings 1-5 done', 'current_state');
      appendNote(o, 'dev', 'later detail', 'note');
    });
    dagCreateTask(daemon!, 'o', 'boss', 'Do it', 'dev', [], undefined, 'the brief');
    expect(await waitUntil(() => first.length >= 1)).toBe(true);
    expect(first[0]).toMatch(/^Your notes from earlier work/);
    expect(first[0]).toContain('CURRENT: listings 1-5 done');
    expect(first[0]).toContain('later detail');
    expect(first[0]).not.toContain('old finding'); // superseded by the current state
    expect(first[0]).toMatch(/\[task:task-1\] Do it\n\nthe brief$/);

    await running.bus.flush();
    const gen = readPacketLog(running.bus.dir).find((r) => r.kind === 'generation' && r.role === 'dev')!;
    const { createHash } = await import('node:crypto');
    expect(gen.first_message_sha256).toBe(createHash('sha256').update(first[0]).digest('hex'));
    expect(gen).toMatchObject({ notes_entries: 2, notes_omitted: 1 });
  });

  it('adds nothing for a role with no notes, or an org without notes: true', async () => {
    const none = await noteOrg({ notes: true });
    dagCreateTask(daemon!, 'o', 'boss', 'Do it', 'dev', [], undefined, 'b');
    expect(await waitUntil(() => none.first.length >= 1)).toBe(true);
    expect(none.first[0]).not.toMatch(/notes from earlier work/);
    await daemon!.stopAll();

    const off = await noteOrg({ require_brief: false }, (o) => appendNote(o, 'dev', 'secret', 'note'));
    dagCreateTask(daemon!, 'o', 'boss', 'Do it', 'dev', [], undefined, 'b');
    expect(await waitUntil(() => off.first.length >= 1)).toBe(true);
    expect(off.first[0]).not.toContain('secret');
  });

  it('never lets the notes push the first message past the variable-parts limit', async () => {
    const { first } = await noteOrg({ notes: true }, (o) => {
      for (let i = 0; i < 5; i++) appendNote(o, 'dev', `note ${i} ${'n'.repeat(900)}`, 'note');
    });
    const brief = 'b'.repeat(3900);
    const refs = { files: Array.from({ length: 60 }, (_, i) => `/very/long/path/${'x'.repeat(100)}/${i}`) };
    dagCreateTask(daemon!, 'o', 'boss', 'Big', 'dev', [], undefined, brief, undefined, refs);
    expect(await waitUntil(() => first.length >= 1)).toBe(true);
    expect(first[0].length).toBeLessThanOrEqual(12_000);
  });
});
