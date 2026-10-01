#!/usr/bin/env node
// Phase 0: answer every open blocking ask_human question with one fixed,
// arm-neutral reply, identically in both arms. No human is available during a
// trial, and an unanswered blocking question holds the idle watchdog for up to
// an hour while the trial does nothing.
// Usage: auto-answer.mjs <trial root> <org name> <cli.js>   (polls every 15s)
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const REPLY =
  'No human is available during this run. Use your own judgement, prefer work you can finish inside this run, and record open decisions in STATUS.md.';

const [root, name, cli] = process.argv.slice(2);
const file = join(root, '.monomind/orgs', name, 'questions.json');
const log = join(root, 'auto-answers.jsonl');

function tick() {
  if (!existsSync(file)) return;
  let questions;
  try {
    questions = JSON.parse(readFileSync(file, 'utf8')).questions ?? [];
  } catch {
    return; // mid-write; next tick
  }
  for (const q of questions) {
    if (q.answer !== undefined || q.dismissed || q.blocking === false) continue;
    try {
      execFileSync('node', [cli, 'org', 'answer', name, q.questionId, REPLY, '--by', 'phase0-harness'], {
        cwd: root,
        stdio: 'ignore',
      });
      appendFileSync(log, `${JSON.stringify({ ts: new Date().toISOString(), questionId: q.questionId, role: q.role })}\n`);
    } catch {
      /* answered or closed meanwhile; next tick re-reads */
    }
  }
}

tick();
setInterval(tick, 15_000);
