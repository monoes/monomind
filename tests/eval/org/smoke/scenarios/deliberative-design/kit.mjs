// Scenario kit: deliberative-design (manifest tests/eval/org/manifests/deliberative-design.json).
// A lead and three role-distinct deliberators choose an on-disk format for the eval harness's
// event log and write a scored decision record and an objection log. The check is machine-only;
// the judgement rubric items (grounded, contested) are flagged for blind review.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const id = 'deliberative-design';

const OPTIONS = ['JSONL', 'SQLite', 'columnar file'];
const CRITERIA = [
  'no new dependency',
  'crash-safe append',
  'inspectable with standard tools',
  'query by role and time',
  'implementation effort',
];
const DISPOSITIONS = ['accepted', 'rejected', 'deferred'];

const QUESTION = `# Question

Which on-disk format should the eval harness use for a trial's event log: JSONL, SQLite, or a columnar file?

## Constraints

- no new runtime dependency
- append-only writes during a run
- readable with standard tools after a crash
- queries by role and time range for reports

## Options (all three must be evaluated; you may add others, but they add nothing to completion)

${OPTIONS.map((o) => `- ${o}`).join('\n')}

## Criteria (score every option 1-5 on each, 5 = best, with a one-line reason)

${CRITERIA.map((c) => `- ${c}`).join('\n')}

## Required output files (in the workspace)

\`decision-record.json\`:

\`\`\`json
{
  "question": "<the question>",
  "options": [
    {
      "name": "<option>",
      "scores": { "<criterion>": { "score": 1, "reason": "<one line>" } },
      "total": 0
    }
  ],
  "chosen": "<option name>",
  "rationale": "<why it wins>"
}
\`\`\`

- \`score\` is an integer 1-5; \`total\` is the sum of that option's scores; \`chosen\` is an option with the highest total.

\`objection-log.json\`: an array, one entry per objection raised during the deliberation:

\`\`\`json
[
  {
    "role": "<role id that raised it>",
    "objection": "<the objection>",
    "disposition": "accepted | rejected | deferred",
    "reason": "<required when rejected>"
  }
]
\`\`\`

- Objections must come from at least two distinct roles. An objection that changed a score counts as accepted.
`;

const CONTEXT = `# Context: facts about the eval harness event log

Verified against the harness source; use them, and do not assume anything beyond them.

- Each org run writes one append-only file, \`bus.jsonl\`, in its run directory: one JSON object per line.
- An event has \`id\`, \`ts\` (epoch milliseconds), \`org\`, \`run\`, \`type\`, \`from\` (the emitting role), and optionally \`msg\`, \`reason\` and \`data\`.
- Usage events (\`type: "usage"\`) carry \`data.cost_usd\`, \`data.tokens\` and \`data.cache_read\`; reports sum them per role (\`from\`).
- Writes come from one process. The bus queues them and appends each line with a separate append call; there are no concurrent writers to the file.
- A crash can leave a torn final line; readers skip lines that do not parse.
- Reports read the whole file at once and filter by \`from\` and \`ts\`; there is no index. A trial's log is one line per event.
- Reports are written in TypeScript on Node. Node ships a built-in \`node:sqlite\` module; no columnar-file library is installed in the repository.
- Standard tools available on any developer machine: \`cat\`, \`grep\`, \`jq\`, \`tail\`.
`;

export async function buildInputs({ dir }) {
  const ws = join(dir, 'workspace');
  mkdirSync(ws, { recursive: true });
  writeFileSync(join(ws, 'QUESTION.md'), QUESTION);
  writeFileSync(join(ws, 'CONTEXT.md'), CONTEXT);
}

export async function baseDef() {
  const policy = { denyTools: ['Bash', 'WebFetch', 'WebSearch'] };
  return {
    def: {
      name: 'deliberative-design',
      goal: 'Decide the on-disk format for the eval harness event log, with recorded objections.',
      run_config: { max_concurrent_agents: 4 },
      roles: [
        {
          id: 'lead',
          title: 'Lead',
          type: 'boss',
          reports_to: null,
          policy,
          responsibilities: [
            'Run the deliberation on QUESTION.md in the workspace. Send each of advocate, critic and synthesiser a self-contained brief naming the files to read; keep every message short.',
            'Order: the advocate scores every option; the critic raises objections; the advocate answers them; then the synthesiser writes decision-record.json and objection-log.json. Complete the task only after both files exist.',
          ],
        },
        {
          id: 'advocate',
          title: 'Advocate',
          type: 'specialist',
          reports_to: 'lead',
          policy,
          responsibilities: [
            'Score every option on every criterion (1-5, one-line reason) using only QUESTION.md and CONTEXT.md, then argue for the best-supported option.',
            'Answer each objection on its merits: concede and re-score where it is right, rebut with facts where it is wrong. Send scores and answers to the synthesiser.',
          ],
        },
        {
          id: 'critic',
          title: 'Critic',
          type: 'specialist',
          reports_to: 'lead',
          policy,
          responsibilities: [
            "Challenge the advocate's scores and claims about each format: raise concrete objections, especially against the option being favoured, and check every claim against CONTEXT.md.",
            'Send each objection to the advocate and the synthesiser, saying which score it would change.',
          ],
        },
        {
          id: 'synthesiser',
          title: 'Synthesiser',
          type: 'specialist',
          reports_to: 'lead',
          policy,
          responsibilities: [
            "Write decision-record.json and objection-log.json in the workspace exactly as QUESTION.md specifies, from the advocate's final scores and the critic's objections.",
            "Set each option's total to the sum of its scores, choose an option with the highest total, and log every objection raised, naming the role that raised it, with its disposition (a rejected one needs a reason).",
          ],
        },
      ],
    },
    task: 'Run the deliberation described in QUESTION.md (read CONTEXT.md too). The advocate scores, the critic objects, the advocate answers, and the synthesiser then writes decision-record.json and objection-log.json in the workspace in the exact schemas QUESTION.md gives. Finish when both files are written.',
    // Sums to the $8 planning allocation; the synthesiser carries the most (it holds the whole debate).
    caps: { lead: 1, advocate: 2, critic: 2, synthesiser: 3 },
    allocationUsd: 8,
    // The session cap counts every token a response carries, cache reads included (session-usage.ts
    // totalTokens), and a role re-reads its whole context on each model call. The dry runs measured
    // 100-370K counted tokens in ONE turn of a Haiku lead or a codex role, so a cap of 40-60K rotated a
    // role on almost every turn and 10-12 times in 10 minutes. 600K is about 2-5 turns of such a role: a
    // session carries a real stretch of work before it rotates, and a looping role is still bounded.
    sessionCap: { tokens: 600_000 },
    deadlineSeconds: 2700,
  };
}

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase();
const isText = (s) => typeof s === 'string' && s.trim() !== '';

function load(workspace, file) {
  try {
    return { value: JSON.parse(readFileSync(join(workspace, file), 'utf8')) };
  } catch (e) {
    return { error: `${file} missing or not valid JSON (${e.code ?? e.message})` };
  }
}

function checkRecord(rec) {
  const failures = [];
  const critical = [];
  if (!rec || typeof rec !== 'object' || Array.isArray(rec) || !Array.isArray(rec.options))
    return { failures: ['decision-record.json is not an object with an options array'], critical };
  if (!isText(rec.question)) failures.push('question missing');
  if (!isText(rec.rationale)) failures.push('rationale missing');
  if (!isText(rec.chosen)) failures.push('chosen missing');
  const totals = new Map(); // normalised option name -> sum of its scores
  for (const o of rec.options) {
    const name = isText(o?.name) ? o.name : '(unnamed)';
    if (!isText(o?.name)) failures.push('an option has no name');
    const scores = o?.scores && typeof o.scores === 'object' ? o.scores : {};
    const present = new Set(Object.keys(scores).map(norm));
    for (const c of CRITERIA)
      if (!present.has(norm(c))) {
        if (OPTIONS.some((m) => norm(m) === norm(name)))
          critical.push(`criterion missing: "${c}" for option "${name}"`);
        failures.push(`option "${name}": criterion "${c}" missing`);
      }
    let sum = 0;
    for (const [k, s] of Object.entries(scores)) {
      if (!Number.isInteger(s?.score) || s.score < 1 || s.score > 5)
        failures.push(`option "${name}": score for "${k}" is not an integer 1-5`);
      else sum += s.score;
      if (!isText(s?.reason)) failures.push(`option "${name}": reason for "${k}" missing`);
    }
    if (o?.total !== sum)
      failures.push(
        `option "${name}": total ${o?.total} does not equal the sum of its scores ${sum}`,
      );
    totals.set(norm(name), sum);
  }
  for (const m of OPTIONS)
    if (!totals.has(norm(m))) {
      critical.push(`mandatory option missing: "${m}"`);
      failures.push(`mandatory option "${m}" missing`);
    }
  if (isText(rec.chosen)) {
    if (!totals.has(norm(rec.chosen)))
      failures.push(`chosen "${rec.chosen}" is not one of the options`);
    else if (totals.get(norm(rec.chosen)) < Math.max(...totals.values())) {
      critical.push(`chosen option "${rec.chosen}" contradicts the record's own scoring`);
      failures.push(`chosen "${rec.chosen}" does not have the highest total`);
    }
  }
  return { failures, critical };
}

function checkLog(log) {
  if (!Array.isArray(log) || log.length === 0)
    return ['objection-log.json is not a non-empty array'];
  const failures = [];
  const roles = new Set();
  log.forEach((o, i) => {
    if (!o || typeof o !== 'object') return failures.push(`objection ${i} is not an object`);
    if (!isText(o.role)) failures.push(`objection ${i}: role missing`);
    else roles.add(norm(o.role));
    if (!isText(o.objection)) failures.push(`objection ${i}: objection text missing`);
    if (!DISPOSITIONS.includes(o.disposition))
      failures.push(
        `objection ${i}: disposition "${o.disposition}" is not accepted|rejected|deferred`,
      );
    else if (o.disposition === 'rejected' && !isText(o.reason))
      failures.push(`objection ${i}: rejected without a reason`);
  });
  if (roles.size < 2)
    failures.push(`objections name ${roles.size} role(s); need two distinct roles`);
  return failures;
}

export async function check({ workspace }) {
  const r = load(workspace, 'decision-record.json');
  const l = load(workspace, 'objection-log.json');
  const rec = r.error ? { failures: [r.error], critical: [] } : checkRecord(r.value);
  const logFailures = l.error ? [l.error] : checkLog(l.value);
  return [
    {
      unit: 'decision-record',
      accepted: rec.failures.length === 0,
      // grounded (claims about each format are true) needs a reader; acceptance is machine-only.
      evidence: { failures: rec.failures, needsReview: true, rubric: ['grounded'] },
      critical: rec.critical,
    },
    {
      unit: 'objection-log',
      accepted: logFailures.length === 0,
      // contested (objections are real, not agreement restated) needs a reader.
      evidence: { failures: logFailures, needsReview: true, rubric: ['contested'] },
      critical: [],
    },
  ];
}
