// The research-report scenario kit for the smoke tier (manifest: manifests/research-report.json).
// A fixed question about a pinned, read-only snapshot of this repo's org runtime, answered
// as report.md plus ledger.json with every claim cited path:line. Everything decidable by
// machine (sections, citations, quotes, counts) is decided here with no model; whether the
// report is accurate and concise is flagged for a blind human reviewer, never guessed.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const id = 'research-report';

const REPO = fileURLToPath(new URL('../../../../../../', import.meta.url));
const ORGRT = 'packages/@monomind/cli/src/orgrt/';

export const QUESTION =
  'How does an org session decide when to end and start a fresh one, and what does each path record? Cover: (1) the task-scope boundary, (2) the idle exit, (3) the budget stops, (4) the session cap. Name the file and function behind each claim.';
export const SUB_QUESTIONS = ['task-scope boundary', 'idle exit', 'budget stops', 'session cap'];

const questionMd = () => `# Question

${QUESTION}

## The four sub-questions

${SUB_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join('\n')}

## What to produce

The material is the read-only directory \`snapshot/\` (the org runtime's TypeScript source,
non-test files only). Use nothing else: no network, no memory of the project.

Write two files in the workspace root:

1. \`report.md\`: one section per sub-question, each opened by a heading whose text is the
   sub-question's name exactly as listed above (for example \`## Idle exit\`). One section
   answers one sub-question; do not merge two into one heading. Say what the code decides and
   what that path records. Name the file and function behind each claim.
2. \`ledger.json\`: a JSON array with one row per citation:
   \`{"path": "<file under snapshot/>", "line": <1-based number>, "quote": "<text copied from that line>", "claim": "<what it supports>"}\`.

Citation format: \`path:line\`, with path relative to \`snapshot/\` (for example
\`session-cap.ts:42\`). Every claim in the report carries a citation. Each citation appears in
the ledger once, and the ledger has exactly as many rows as the report has distinct citations.
The quote must appear verbatim on the cited line. Do not repeat a citation to raise the count.
`;

/** Non-test source of the orgrt directory at HEAD, read from git so the snapshot is exactly the commit. */
export async function buildInputs({ dir }) {
  const git = (...a) =>
    execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const commit = git('rev-parse', 'HEAD').trim();
  const files = git('ls-tree', '--name-only', `HEAD:${ORGRT}`)
    .split('\n')
    .filter((f) => f.endsWith('.ts') && !/\.(test|spec)\.ts$/.test(f));
  if (files.length === 0) throw new Error(`no orgrt sources found at HEAD in ${REPO}`);
  const ws = join(dir, 'workspace');
  mkdirSync(join(ws, 'snapshot'), { recursive: true });
  for (const f of files) writeFileSync(join(ws, 'snapshot', f), git('show', `HEAD:${ORGRT}${f}`));
  writeFileSync(join(ws, 'QUESTION.md'), questionMd());
  writeFileSync(
    join(dir, 'meta.json'),
    `${JSON.stringify({ commit, files: files.length }, null, 2)}\n`,
  );
}

/** Per-role USD soft stops; they sum to the manifest's $8 planning allocation. */
const CAPS = { lead: 2, 'researcher-a': 2, 'researcher-b': 2, verifier: 2 };
/** No network; shell (grep, sed) pre-approved so no role waits on a human. */
const POLICY = { autoApproveTools: ['Bash'], denyTools: ['WebFetch', 'WebSearch'] };

export async function baseDef({ workspace }) {
  const role = (r) => ({ ...r, policy: structuredClone(POLICY) });
  return {
    def: {
      name: 'research-report',
      goal: 'Answer a fixed question about the org runtime with a cited report and a verified source ledger.',
      run_config: { workspace },
      roles: [
        role({
          id: 'lead',
          title: 'Research lead',
          type: 'boss',
          reports_to: null,
          responsibilities: [
            'Read QUESTION.md in the workspace, then give each researcher a self-contained brief: the exact sub-questions it owns, the snapshot/ directory, and the return format (rows of path, line, quote, claim).',
            'Assemble report.md (one section per sub-question, headed by the sub-question name, every claim cited path:line) and ledger.json (one row per distinct citation) in the workspace root.',
            'Send ledger.json to the verifier, apply its corrections, and keep the ledger row count equal to the report distinct citation count.',
            'Call org_complete only after the verifier confirms every row resolves.',
          ],
        }),
        role({
          id: 'researcher-a',
          title: 'Researcher: task-scope boundary and session cap',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: [
            'Research the task-scope boundary and the session cap in snapshot/ using grep and sed -n; read only what the brief names.',
            'Return rows of path, line, quote, claim; copy each quote from the cited line, never from memory.',
          ],
        }),
        role({
          id: 'researcher-b',
          title: 'Researcher: idle exit and budget stops',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: [
            'Research the idle exit and the budget stops in snapshot/ using grep and sed -n; read only what the brief names.',
            'Return rows of path, line, quote, claim; copy each quote from the cited line, never from memory.',
          ],
        }),
        role({
          id: 'verifier',
          title: 'Citation verifier',
          type: 'specialist',
          reports_to: 'lead',
          responsibilities: [
            'For each row of ledger.json, run sed -n on the cited line of the file under snapshot/ and confirm the quote appears on that line.',
            'Report to the lead each row that fails, with the correct line if you find it; never edit report.md.',
          ],
        }),
      ],
    },
    task: `Answer the question in QUESTION.md using the snapshot/ directory of the workspace (${workspace}). Produce report.md and ledger.json in that workspace root, in the format QUESTION.md specifies.`,
    caps: CAPS,
    allocationUsd: 8,
    // A Haiku researcher reading excerpts for two sub-questions processes roughly 20-40k
    // de-duplicated tokens, so 60000 lets a normal session finish in one generation and
    // rotates it only when it runs long (re-reading files, wandering into other sub-questions).
    sessionCap: { tokens: 60_000 },
    deadlineSeconds: 2700,
  };
}

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ')
    .trim();
const CITE_G = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.ts):(\d+)\b/g;
const CITE_ONE = /(?<![\w./-])((?:[\w.-]+\/)*[\w.-]+\.ts):(\d+)\b/;

/** A citation path as the snapshot knows it: a leading `snapshot/` (or `./snapshot/`) names the same
 *  file, and models writing the ledger often include it, so it never decides a citation either way. */
const bare = (path) => path.replace(/^(?:\.\/)?snapshot\//, '');

/** Look up path:line inside the snapshot; returns {text} or {error}. */
function resolveLine(snapshot, path, line) {
  path = bare(path);
  const abs = resolve(snapshot, path);
  if (!abs.startsWith(snapshot + sep) || !existsSync(abs)) return { error: `no such file ${path}` };
  const lines = readFileSync(abs, 'utf8').split('\n');
  if (lines.at(-1) === '') lines.pop();
  if (!Number.isInteger(line) || line < 1 || line > lines.length)
    return { error: `${path}:${line} is outside 1..${lines.length}` };
  return { text: lines[line - 1].replace(/\r$/, '') };
}

function sectionsOf(md) {
  const lines = md.split('\n');
  const heads = [];
  let fence = false;
  lines.forEach((l, i) => {
    if (/^\s*```/.test(l)) fence = !fence;
    const m = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (m) heads.push({ i, level: m[1].length, title: m[2] });
  });
  return heads.map((h, k) => {
    const next = heads.slice(k + 1).find((n) => n.level <= h.level);
    return { ...h, body: lines.slice(h.i + 1, next ? next.i : lines.length).join('\n') };
  });
}

const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8') : undefined);

function checkReport(md, snapshot) {
  const failures = [];
  const critical = [];
  if (md === undefined) return { failures: ['report.md is missing'], critical, citations: [] };
  const sections = sectionsOf(md);
  const covered = {};
  for (const q of SUB_QUESTIONS) {
    const hits = sections.filter((s) => norm(s.title).includes(norm(q)));
    covered[q] = hits.length;
    if (hits.length === 0) failures.push(`no section for sub-question "${q}"`);
    else if (!hits.some((s) => CITE_ONE.test(s.body)))
      failures.push(`section for "${q}" cites nothing`);
  }
  for (const s of sections) {
    const named = SUB_QUESTIONS.filter((q) => norm(s.title).includes(norm(q)));
    if (named.length > 1)
      failures.push(`one heading answers two sub-questions: "${s.title}" (${named.join(' + ')})`);
  }
  const keys = new Map();
  for (const m of md.matchAll(CITE_G))
    keys.set(`${bare(m[1])}:${Number(m[2])}`, [bare(m[1]), Number(m[2])]);
  for (const [key, [p, l]] of keys) {
    const r = resolveLine(snapshot, p, l);
    if (r.error) {
      failures.push(`report citation ${key} does not resolve: ${r.error}`);
      critical.push(`unresolvable citation in report: ${key}`);
    }
  }
  return { failures, critical, citations: [...keys.keys()], covered };
}

function checkLedger(raw, snapshot, reportCount) {
  const failures = [];
  const critical = [];
  if (raw === undefined) return { failures: ['ledger.json is missing'], critical, rows: 0 };
  let rows;
  try {
    rows = JSON.parse(raw);
  } catch {
    return { failures: ['ledger.json is not valid JSON'], critical, rows: 0 };
  }
  if (!Array.isArray(rows)) return { failures: ['ledger.json is not an array'], critical, rows: 0 };
  const seen = new Set();
  rows.forEach((row, i) => {
    const at = `ledger row ${i}`;
    const ok =
      row &&
      typeof row.path === 'string' &&
      Number.isInteger(row.line) &&
      typeof row.quote === 'string' &&
      typeof row.claim === 'string' &&
      row.claim.trim() !== '';
    if (!ok) return failures.push(`${at} lacks path, integer line, quote or claim`);
    const key = `${bare(row.path)}:${row.line}`;
    if (seen.has(key)) failures.push(`${at} repeats ${key}`);
    seen.add(key);
    const r = resolveLine(snapshot, row.path, row.line);
    if (r.error) {
      failures.push(`${at} does not resolve: ${r.error}`);
      return critical.push(`unresolvable citation in ledger: ${key}`);
    }
    const q = row.quote.trim();
    if (q === '' || !r.text.includes(q)) {
      failures.push(`${at} quote is not on ${key}`);
      critical.push(`quote not at cited line: ${key}`);
    }
  });
  if (rows.length !== reportCount)
    failures.push(
      `ledger has ${rows.length} rows but the report has ${reportCount} distinct citations`,
    );
  return { failures, critical, rows: rows.length, keys: [...seen] };
}

export async function check({ workspace, inputs }) {
  const snapshot = join(resolve(inputs), 'workspace', 'snapshot'); // the immutable copy, not the trial's
  const rep = checkReport(read(join(workspace, 'report.md')), snapshot);
  const led = checkLedger(read(join(workspace, 'ledger.json')), snapshot, rep.citations.length);
  const ledKeys = led.keys ?? [];
  const notInLedger = rep.citations.filter((k) => !ledKeys.includes(k));
  const notInReport = ledKeys.filter((k) => !rep.citations.includes(k));
  // A ledger lists every citation: equal counts built from different lines still fail.
  const mismatch = [
    ...(notInLedger.length
      ? [`report cites what the ledger lacks: ${notInLedger.join(', ')}`]
      : []),
    ...(notInReport.length
      ? [`ledger lists what the report never cites: ${notInReport.join(', ')}`]
      : []),
  ];
  const noCitations = rep.citations.length === 0 ? ['the report has no citations'] : [];
  return [
    {
      unit: 'report',
      accepted: rep.failures.length === 0,
      critical: rep.critical,
      evidence: {
        failures: rep.failures,
        citations: rep.citations.length,
        sections: rep.covered ?? {},
        needsReview: true, // accurate and concise need a blind reviewer
      },
    },
    {
      unit: 'source-ledger',
      accepted: led.failures.length === 0 && noCitations.length === 0 && mismatch.length === 0,
      critical: led.critical,
      evidence: {
        failures: [...led.failures, ...noCitations, ...mismatch],
        rows: led.rows,
        reportCitations: rep.citations.length,
        notInLedger,
        notInReport,
        needsReview: true, // whether each claim matches its line is a human judgement
      },
    },
  ];
}
