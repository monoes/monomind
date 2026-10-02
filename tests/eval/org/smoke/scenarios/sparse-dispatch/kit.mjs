// tests/eval/org/smoke/scenarios/sparse-dispatch/kit.mjs
//
// The sparse-dispatch scenario kit (manifest: tests/eval/org/manifests/sparse-dispatch.json).
// A long-lived steward answers 12 ledger lookups that reach it in 4 bursts of 3,
// each burst further from the last than the prompt cache's time to live, so its
// session goes cold between bursts and, under the phase2 contender, rotates.
//
// Org shape: a `lead` root and the `steward` as its report. The root is
// role-scoped (spec A39), and the contender's `session_scope: 'task'` is about
// the non-root roles; the steward is the role the contender is meant to change.
// Tickets reach the steward untagged, through `org inbox --to steward` (see driver.mjs),
// so the whole run is one steward session per generation, not one per ticket.
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJson } from '../../lib.mjs';

export const id = 'sparse-dispatch';

/** Seconds between bursts: the manifest's 6 minutes plus 60s margin. It must
 *  exceed the 5-minute prompt-cache TTL (so each burst starts cold) and stay
 *  under the 10 minutes of bus silence after which run-trial's watchdog ends a run. */
export const GAP_SECONDS = 420;
export const CACHE_TTL_SECONDS = 300;

/** The gap in force: GAP_SECONDS, or SMOKE_GAP_SECONDS for a dry run or a test.
 *  A shrunk gap voids the cache-expiry condition and is recorded in schedule.json. */
export function gapSeconds() {
  const raw = process.env.SMOKE_GAP_SECONDS;
  if (raw === undefined || raw === '') return GAP_SECONDS;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new Error(`SMOKE_GAP_SECONDS must be a positive integer, got "${raw}"`);
  return n;
}

/** The phase2 session cap, in the runtime's own counting.
 *  The cap counts, per model call of the main session, input + output + cache
 *  read + cache creation tokens (session-usage.ts totalTokens), so every call
 *  adds the whole context it read, not just the new text: roughly the Claude
 *  Code prefix (system prompt and tools, ~15-25K) plus the notes and the
 *  turn so far. A ticket takes about 3 calls (look up, append the answer, final
 *  reply), so ~30-75K counted tokens per ticket, 360-900K over the 12. At 100K
 *  a generation ends after 2-4 tickets, which gives at least 2 rotations even at
 *  the low end (12 x 25K = 300K -> 2 rotations) and no more than about 8 at the
 *  high end. The estimate is not measured; a dry run reports the real count of
 *  `session-rotated` events and the cap is fixed in this file before any trial. */
export const SESSION_CAP_TOKENS = 100_000;
export const SESSION_CAP = { tokens: SESSION_CAP_TOKENS };

const BURSTS = 4;
const PER_BURST = 3;
const LEDGER_SIZE = 40;
const SEED = 20261002;
/** Later tickets ask again for the key an earlier ticket asked (index -> earlier index),
 *  so state lost across a rotation shows up as a wrong answer to a known key. */
const REPEATS = { 6: 1, 9: 0, 11: 4 };

const ticketId = (i) => `T${String(i + 1).padStart(2, '0')}`;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** The ledger and the 12 tickets: pure and fixed by SEED. */
export function buildLedgerAndTruth() {
  const rnd = mulberry32(SEED);
  const word = (n) =>
    Array.from({ length: n }, () => ALPHABET[Math.floor(rnd() * ALPHABET.length)]).join('');
  const ledger = {};
  const used = new Set();
  while (Object.keys(ledger).length < LEDGER_SIZE) {
    const key = `acct-${1000 + Math.floor(rnd() * 9000)}`;
    if (key in ledger) continue;
    let value = `${word(5)}-${word(4)}`;
    while (used.has(value) || value.includes(key.slice(-4))) value = `${word(5)}-${word(4)}`;
    used.add(value);
    ledger[key] = value;
  }
  const order = Object.keys(ledger)
    .map((k) => [rnd(), k])
    .sort((a, b) => a[0] - b[0])
    .map(([, k]) => k);
  const keys = order.slice(0, BURSTS * PER_BURST);
  for (const [i, from] of Object.entries(REPEATS)) keys[i] = keys[from];
  const tickets = keys.map((key, i) => ({
    ticket: ticketId(i),
    key,
    burst: Math.floor(i / PER_BURST),
  }));
  return { ledger, truth: { tickets } };
}

export async function buildInputs({ dir }) {
  const { ledger, truth } = buildLedgerAndTruth();
  mkdirSync(join(dir, 'workspace'), { recursive: true });
  writeJson(join(dir, 'workspace', 'ledger.json'), ledger);
  writeJson(join(dir, 'truth.json'), truth);
  const gap = gapSeconds();
  writeJson(join(dir, 'schedule.json'), {
    gapSeconds: gap,
    gapShrunk: gap !== GAP_SECONDS,
    cacheTtlSeconds: CACHE_TTL_SECONDS,
    bursts: Array.from({ length: BURSTS }, (_, b) => ({
      index: b,
      offsetSeconds: b * gap,
      tickets: truth.tickets.filter((t) => t.burst === b).map((t) => t.ticket),
    })),
  });
}

/** Identical for both contenders: the contender changes run_config only. The
 *  notes line is conditional on the tool existing, so it is the same text
 *  whether or not the org has notes. */
const stewardResponsibilities = () => [
  'You are the steward. Lookup tickets arrive as mail from ops:requester over about 25 minutes, in bursts with long quiet gaps. Each names a ticket (T01..T12) and a ledger key.',
  `For each ticket, find the key's value in ledger.json in your working directory, the workspace (a JSON object, one "key": "value" per line). Look up just that key, for example with grep; never print the whole ledger.`,
  `Record each answer with one command, appending one line to answers.jsonl: echo '{"ticket":"T03","key":"<key>","value":"<value>","at":'$(date +%s%3N)'}' >> answers.jsonl. The value is copied exactly from the ledger. Answer each ticket once, and reply to the requester in one short line.`,
  'If you have an org_note_append tool, keep your notes current: after each ticket, append a current_state entry that lists the tickets answered so far and any key you have already looked up with its value.',
  'After you answer ticket T12, the last one, tell the lead with org_send that all 12 tickets are answered.',
];

const leadResponsibilities = [
  'You are the lead of a small org whose steward answers lookup tickets that arrive by mail by themselves. Do not create tasks or plans, do not message the steward, and do not look anything up yourself.',
  'Wait. When the steward tells you all 12 tickets are answered, call org_complete with outcome achieved.',
];

export const TASK =
  'The steward answers 12 ledger lookup tickets that arrive by mail over the next half hour. You have nothing to dispatch: end your turn now and wait for the steward to report that all 12 are answered, then call org_complete.';

export async function baseDef({ workspace }) {
  return {
    def: {
      name: 'sparse-dispatch',
      goal: 'The steward answers 12 ledger lookups that arrive in bursts; the lead completes the run once all are answered.',
      run_config: { workspace },
      roles: [
        {
          id: 'lead',
          title: 'Lead',
          type: 'boss',
          reports_to: null,
          responsibilities: leadResponsibilities,
        },
        {
          id: 'steward',
          title: 'Ledger steward',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: stewardResponsibilities(),
        },
      ],
    },
    task: TASK,
    // Soft USD stops, summing to the $8 planning allocation. The run is a few hundred thousand cached tokens on Haiku.
    caps: { lead: 1, steward: 7 },
    allocationUsd: 8,
    sessionCap: SESSION_CAP,
    deadlineSeconds: 3600,
    driver: join(dirname(fileURLToPath(import.meta.url)), 'driver.mjs'),
  };
}

// ---- check -------------------------------------------------------------

const STATE_LOST =
  'state lost across a rotation so that a previously answered key is answered wrongly';
const NOT_IN_LEDGER = 'an answer that is not in the ledger';
const DROPPED = 'a ticket dropped or never answered';

const readLines = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((l) => {
          try {
            return l.trim() ? [JSON.parse(l)] : [];
          } catch {
            return []; // a torn or malformed line
          }
        })
    : [];

/** The steward's `session-rotated` audit events, oldest first, from every run directory of the org. */
function rotationsOf(orgDir) {
  if (!existsSync(orgDir)) return [];
  return readdirSync(orgDir)
    .filter((d) => /^run-/.test(d))
    .sort()
    .flatMap((d) => readLines(join(orgDir, d, 'bus.jsonl')))
    .filter(
      (e) =>
        e.reason === 'session-rotated' &&
        (e.data?.role ?? e.from) === 'steward' &&
        Number.isFinite(e.ts),
    )
    .sort((a, b) => a.ts - b.ts);
}

/** The steward's notes, in the format notes.ts writes: `## <iso> · <kind> · <length>\n<text>\n\n`. */
function readStewardNotes(orgDir) {
  const file = join(orgDir, 'notes', 'steward.md');
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  const header = /^## (\S+) · (note|current_state) · (\d+)\n/;
  const out = [];
  let pos = 0;
  while (pos < raw.length) {
    const m = header.exec(raw.slice(pos));
    if (!m) break;
    const start = pos + m[0].length;
    const len = Number(m[3]);
    if (start + len > raw.length) break;
    out.push({ atMs: Date.parse(m[1]), kind: m[2] });
    pos = start + len + 2;
  }
  return out;
}

function handoffNotes({ contender, orgDir, rows, matches, totalAnswersCorrect }) {
  if (contender !== 'phase2')
    return {
      unit: 'handoff-notes',
      accepted: null,
      evidence: {
        notApplicable: true,
        reason: 'the current-best contender has no notes and no session cap, so nothing rotates',
      },
    };
  const rotations = rotationsOf(orgDir);
  if (rotations.length < 2)
    return {
      unit: 'handoff-notes',
      accepted: null,
      evidence: {
        rotationsRecorded: rotations.length,
        reason: 'the fixture is meant to force at least two rotations; left to review, not guessed',
      },
    };
  const notes = readStewardNotes(orgDir);
  const timed = rows.filter((r) => Number.isFinite(r.at)).sort((a, b) => a.at - b.at);
  const per = rotations.map((rot, k) => {
    const prev = k === 0 ? 0 : rotations[k - 1].ts;
    // A note of either kind counts: the runtime injects the last current_state plus every later note.
    const notesSincePrevious = notes.filter((n) => n.atMs > prev && n.atMs <= rot.ts).length;
    // Without answer times the order cannot be placed against a rotation: fall back to every answer being right.
    const first = timed.find((r) => r.at > rot.ts);
    const firstAnswerCorrect = timed.length
      ? first !== undefined && matches(first)
      : totalAnswersCorrect;
    return {
      rotatedAt: rot.ts,
      generation: rot.data?.generation,
      noteSincePrevious: notesSincePrevious > 0,
      notesSincePrevious,
      firstAnswerTicket: first?.ticket ?? null,
      firstAnswerCorrect,
    };
  });
  return {
    unit: 'handoff-notes',
    accepted: per.every((r) => r.noteSincePrevious && r.firstAnswerCorrect),
    evidence: {
      rotationsRecorded: rotations.length,
      rotations: per,
      currentStateEntries: notes.filter((n) => n.kind === 'current_state').length,
      ...(timed.length ? {} : { answerTimesUnavailable: true }),
    },
  };
}

/** The machine checks of the manifest. Each ticket-answer entry may carry `critical`:
 *  the manifest's critical-failure strings that this ticket's outcome triggers. */
export async function check({ root, inputs, trial, workspace }) {
  const truth = readJson(join(inputs, 'truth.json'));
  const ledger = readJson(join(inputs, 'workspace', 'ledger.json'));
  const schedule = readJson(join(inputs, 'schedule.json'));
  const orgDir = join(root, '.monomind', 'orgs', trial.name);
  const rows = readLines(join(workspace, 'answers.jsonl')).filter(
    (r) => r && typeof r.ticket === 'string',
  );
  const expected = new Map(truth.tickets.map((t) => [t.ticket, ledger[t.key]]));
  const matches = (r) => expected.has(r.ticket) && r.value === expected.get(r.ticket);
  const firstOf = (ticket) => rows.find((r) => r.ticket === ticket);
  const allValues = new Set(Object.values(ledger));
  const rotations = rotationsOf(orgDir);

  const units = truth.tickets.map((t, i) => {
    const row = firstOf(t.ticket);
    const accepted = row !== undefined && matches(row);
    const critical = [];
    if (!row) critical.push(DROPPED);
    else if (typeof row.value !== 'string' || !allValues.has(row.value))
      critical.push(NOT_IN_LEDGER);
    else if (!accepted) {
      const earlier = truth.tickets
        .slice(0, i)
        .map((e) => firstOf(e.ticket))
        .find((e, j) => truth.tickets[j].key === t.key && e && matches(e));
      const between = (rot) =>
        Number.isFinite(earlier?.at) && Number.isFinite(row.at)
          ? rot.ts > earlier.at && rot.ts <= row.at
          : true;
      if (earlier && rotations.some(between)) critical.push(STATE_LOST);
    }
    return {
      unit: 'ticket-answer',
      accepted,
      ...(critical.length ? { critical } : {}),
      evidence: {
        ticket: t.ticket,
        key: t.key,
        burst: t.burst,
        expected: expected.get(t.ticket),
        answered: row?.value ?? null,
        answeredAt: row?.at ?? null,
      },
    };
  });
  const totalAnswersCorrect = units.every((u) => u.accepted);
  units.push(
    handoffNotes({ contender: trial.contender, orgDir, rows, matches, totalAnswersCorrect }),
  );
  units[units.length - 1].evidence.gapSeconds = schedule.gapSeconds;
  units[units.length - 1].evidence.gapExceedsCacheTtl = schedule.gapSeconds > CACHE_TTL_SECONDS;
  return units;
}
