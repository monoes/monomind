// Scores the parallel-sweep deliverables against the hidden truth.json (never given to the agents).
//   scoreModule(answers, truth, moduleId)  one module sheet {module, answers:[{q, value, files}]}
//   scoreSynthesis(answers, truth)         synthesis {answers:[{q, value}]}
//   checkDeliverables(dir, truth)          {units:[{unit, accepted, evidence:{failures}}], critical:[...]}
// CLI: node score.mjs <deliverables dir> --truth <truth.json>
//   <dir>/<module>/answers.json for every module in the truth (m1..m8, or m1..m32 for parallel-sweep-2) and <dir>/synthesis.json
// Evidence names the question and what is wrong, never the expected value.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MODULE_ACCEPT_AT = 11;

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Indexes the answers by question id; reports duplicates and answers for questions that do not exist. */
function index(list, known, label) {
  const byQ = new Map();
  const failures = [];
  const fabricated = [];
  if (!Array.isArray(list))
    return { byQ, failures: [`${label}: answers is not a list`], fabricated };
  for (const a of list) {
    if (!isObj(a) || typeof a.q !== 'string') {
      failures.push(`${label}: an answer without a question id`);
      continue;
    }
    if (!known.has(a.q)) {
      fabricated.push(`${label}: an answer for ${a.q}, which is not a question`);
      continue;
    }
    if (byQ.has(a.q)) failures.push(`${a.q}: answered more than once`);
    else byQ.set(a.q, a);
  }
  return { byQ, failures, fabricated };
}

export function scoreModule(answers, truth, moduleId) {
  const t = truth.modules?.[moduleId];
  if (!t) throw new Error(`no truth for module ${moduleId}`);
  const questions = Object.keys(t);
  const { byQ, failures, fabricated } = index(answers?.answers, new Set(questions), moduleId);
  if (!isObj(answers)) failures.push(`${moduleId}: the sheet is not an object`);
  else if (answers.module !== moduleId)
    failures.push(`${moduleId}: the sheet names module ${answers.module}`);
  let correct = 0;
  for (const q of questions) {
    const a = byQ.get(q);
    if (!a) {
      failures.push(`${q}: not answered`);
      continue;
    }
    const valueOk = a.value === t[q].value;
    const filesOk = same(a.files, t[q].files);
    if (valueOk && filesOk) correct++;
    else
      failures.push(
        `${q}: ${[!valueOk && 'wrong value', !filesOk && 'wrong file list'].filter(Boolean).join(' and ')}`,
      );
  }
  return {
    accepted: correct >= MODULE_ACCEPT_AT && isObj(answers) && answers.module === moduleId,
    correct,
    total: questions.length,
    failures,
    fabricated,
  };
}

export function scoreSynthesis(answers, truth) {
  const questions = Object.keys(truth.synthesis);
  const { byQ, failures, fabricated } = index(answers?.answers, new Set(questions), 'synthesis');
  let correct = 0;
  for (const q of questions) {
    const a = byQ.get(q);
    if (!a) failures.push(`${q}: not answered`);
    else if (same(a.value, truth.synthesis[q].value)) correct++;
    else failures.push(`${q}: wrong value`);
  }
  return {
    accepted: correct === questions.length,
    correct,
    total: questions.length,
    failures,
    fabricated,
  };
}

const readJson = (path) => {
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch (e) {
    return { error: e.code === 'ENOENT' ? 'file is missing' : 'file is not valid JSON' };
  }
};

export function checkDeliverables(dir, truth) {
  const units = [];
  const critical = [];
  const sheets = {};
  for (const m of Object.keys(truth.modules)) {
    const r = readJson(join(dir, m, 'answers.json'));
    if (r.error) {
      units.push({
        unit: 'module-sheet',
        module: m,
        accepted: false,
        evidence: { exact: false, failures: [`${m}: ${r.error}`] },
      });
      continue;
    }
    sheets[m] = r.value;
    const s = scoreModule(r.value, truth, m);
    critical.push(...s.fabricated);
    units.push({
      unit: 'module-sheet',
      module: m,
      accepted: s.accepted,
      // `exact`: 12 of 12, the stricter secondary accuracy metric (the unit rule stays 11 of 12)
      evidence: {
        correct: s.correct,
        total: s.total,
        exact: s.correct === s.total,
        failures: s.failures,
      },
    });
  }
  // an answer list copied from another module's sheet
  const seen = new Map();
  for (const [m, sheet] of Object.entries(sheets)) {
    const key = JSON.stringify(sheet?.answers);
    if (!Array.isArray(sheet?.answers) || sheet.answers.length === 0) continue;
    if (seen.has(key))
      critical.push(`${seen.get(key)} and ${m} carry identical answer lists (copied)`);
    else seen.set(key, m);
  }
  const syn = readJson(join(dir, 'synthesis.json'));
  if (syn.error) {
    units.push({
      unit: 'synthesis',
      accepted: false,
      evidence: { failures: [`synthesis: ${syn.error}`] },
    });
  } else {
    const s = scoreSynthesis(syn.value, truth);
    critical.push(...s.fabricated);
    units.push({
      unit: 'synthesis',
      accepted: s.accepted,
      evidence: { correct: s.correct, total: s.total, failures: s.failures },
    });
  }
  return { units, critical };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dir = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--truth');
  const truthPath = args[args.indexOf('--truth') + 1];
  if (!dir || args.indexOf('--truth') < 0)
    throw new Error('usage: node score.mjs <deliverables dir> --truth <truth.json>');
  console.log(
    JSON.stringify(checkDeliverables(dir, JSON.parse(readFileSync(truthPath, 'utf8'))), null, 2),
  );
}
