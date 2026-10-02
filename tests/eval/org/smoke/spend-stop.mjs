#!/usr/bin/env node
// Harness-side org-wide USD stop for a trial (run-trial.sh starts it when trial.json has
// orgStopUsd). The runtime has per-role soft caps only. When the latest run's summed
// usage cost reaches the limit this writes what `org stop` writes (an ISO timestamp in
// <root>/.monomind/orgs/<name>/stop, which org-poll.ts and pilot/run-org.ts both honour)
// and <root>/spend-stopped.json, then returns.
//
//   node spend-stop.mjs <root> <name> <limit usd> [poll seconds; default 15]
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function busEvents(runDir) {
  const file = join(runDir, 'bus.jsonl');
  if (!existsSync(file)) return [];
  const events = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      if (line.trim()) events.push(JSON.parse(line));
    } catch {} // a torn last line is still being written
  }
  return events;
}

const sumUsd = (events) =>
  events.reduce(
    (s, e) =>
      e.type === 'usage' && typeof e.data?.cost_usd === 'number' ? s + e.data.cost_usd : s,
    0,
  );

export function spendOf(runDir) {
  return sumUsd(busEvents(runDir));
}

function latestRunDir(root, name) {
  const dir = join(root, '.monomind/orgs', name);
  const runs = existsSync(dir)
    ? readdirSync(dir)
        .filter((d) => d.startsWith('run-'))
        .sort()
    : [];
  return runs.length ? join(dir, runs[runs.length - 1]) : dir;
}

/** Resolves 'spend-stopped' once the stop is written, or 'org-stopped' if the org ended first. */
export async function watchSpend({
  root,
  name,
  limitUsd,
  pollMs,
  now = () => new Date().toISOString(),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
}) {
  for (;;) {
    const events = busEvents(latestRunDir(root, name));
    if (events.some((e) => e.reason === 'org-stopped')) return 'org-stopped';
    const atUsd = sumUsd(events);
    if (atUsd >= limitUsd) {
      mkdirSync(join(root, '.monomind/orgs', name), { recursive: true });
      writeFileSync(join(root, '.monomind/orgs', name, 'stop'), now());
      writeFileSync(
        join(root, 'spend-stopped.json'),
        `${JSON.stringify({ atUsd, limitUsd, at: now() })}\n`,
      );
      return 'spend-stopped';
    }
    await sleep(pollMs);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const [root, name, limit, poll = '15'] = process.argv.slice(2);
  const limitUsd = Number(limit);
  const pollMs = Number(poll) * 1000;
  if (!root || !name || !(limitUsd > 0) || !(pollMs > 0)) {
    console.error('usage: spend-stop.mjs <root> <name> <limit usd> [poll seconds]');
    process.exit(2);
  }
  await watchSpend({ root: resolve(root), name, limitUsd, pollMs });
}
