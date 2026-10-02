#!/usr/bin/env node
// Phase 0: answer every open ask_human question (blocking or not) and approve
// every pending org_gate, each with one fixed, arm-neutral reply, identically
// in both arms. No human is available during a trial; an unanswered blocking
// question or a pending gate holds the idle watchdog for up to an hour while
// the trial does nothing. Outbound tools are recording stubs, so an approval
// cannot publish anything.
// Usage: auto-answer.mjs <trial root> <org name> <cli.js>   (polls every 15s)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPLY =
  'No human is available during this run. Use your own judgement, prefer work you can finish inside this run, and record open decisions in STATUS.md.';

const [root, name, cli] = process.argv.slice(2);
export const GATE_REPLY =
  'Approved. No human is available during this run; outbound actions are recorded, not published. Proceed with your own judgement and record open decisions in STATUS.md.';

const file = join(root, '.monomind/orgs', name, 'questions.json');
const gatesFile = join(root, '.monomind/orgs', name, 'gates.json');
const log = join(root, 'auto-answers.jsonl');

const readList = (path, key) => {
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, 'utf8'))[key] ?? [];
  } catch {
    return []; // mid-write; next tick
  }
};

function resolve(args, entry) {
  try {
    execFileSync('node', [cli, 'org', ...args, '--by', 'phase0-harness'], {
      cwd: root,
      stdio: 'ignore',
    });
    appendFileSync(log, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`);
  } catch {
    /* resolved, closed or undeliverable meanwhile; next tick re-reads */
  }
}

function tick() {
  for (const g of readList(gatesFile, 'gates')) {
    if (g.status !== 'pending') continue;
    resolve(['gate-approve', name, g.id, GATE_REPLY], {
      gateId: g.id,
      role: g.roleId,
      kind: 'gate',
    });
  }
  const questions = readList(file, 'questions');
  for (const q of questions) {
    // Open as question-state.ts's isOpenQuestion defines it: no answer yet
    // (stored as null) and not dismissed.
    if (q.answer != null || q.state === 'dismissed') continue;
    resolve(['answer', name, q.questionId, REPLY], {
      questionId: q.questionId,
      role: q.role,
      kind: 'question',
      blocking: q.blocking !== false,
    });
  }
}

tick();
setInterval(tick, 15_000);
