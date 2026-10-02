#!/usr/bin/env node
// The sparse-dispatch ticket injector. run-trial.sh starts it beside `org run`:
//   node driver.mjs <trial root> <org name> <cli.js>
//
// It waits until the org's daemon is registered with the machine-local broker
// (the live delivery route needs it; without it `org inbox` only spools to a
// file that is drained when the org next starts, which would never happen in
// this run), then delivers each ticket to the steward at its burst's offset
// from that moment, and writes one line per attempt to <root>/driver-events.jsonl.
//
// Delivery route: `monomind org inbox <org> --to steward --from ops:requester
// --subject ... --body ... --format json`. It is the one CLI path that reaches a
// role other than the coordinator from outside the daemon: it POSTs to the
// daemon's /api/xdeliver as the operator, and the mail lands in the steward's
// mailbox. The mail carries no `[task:<id>]` tag on purpose: under task scope a
// distinct tag per ticket would give every ticket its own model session, and
// the scenario is about ONE long-lived session going cold between bursts and
// rotating. An untagged message belongs to the role's current session
// (session.ts, mailRouteKey).
import { execFile } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);

export const STEWARD = 'steward';
export const SENDER = 'ops:requester';
const BROKER_FRESH_MS = 90_000;
/** What `org inbox` says when it only spooled the message (no live daemon). */
const OFFLINE_RECEIPT = /delivered when the org next runs/;

/** Every ticket with its burst offset, in delivery order. */
export function planDeliveries(schedule, truth) {
  const byId = new Map(truth.tickets.map((t) => [t.ticket, t]));
  return schedule.bursts.flatMap((b) =>
    b.tickets.map((id) => {
      const t = byId.get(id);
      if (!t) throw new Error(`the schedule names ticket ${id}, which the truth does not have`);
      return { ticket: id, key: t.key, burst: b.index, offsetSeconds: b.offsetSeconds };
    }),
  );
}

/** One ticket's mail. Untagged: see the header comment. */
export function ticketMessage({ ticket, key }) {
  return {
    subject: `ticket ${ticket}`,
    body: `Ticket ${ticket}: what is the ledger value for the key ${key}? Look it up and record your answer for ${ticket} as your instructions say.`,
  };
}

/** argv for `node`: the `org inbox` call that delivers one ticket to the steward. */
export function inboxArgs({ cli, org, ticket, key }) {
  const { subject, body } = ticketMessage({ ticket, key });
  return [
    cli,
    'org',
    'inbox',
    org,
    '--to',
    STEWARD,
    '--from',
    SENDER,
    '--subject',
    subject,
    '--body',
    body,
    '--format',
    'json',
  ];
}

/** The org counts as up when its daemon's broker entry is fresh. */
export function brokerIsUp(org, dir = process.env.MONOMIND_ORGRT_BROKER_DIR) {
  try {
    const file = join(dir || join(homedir(), '.monomind', 'orgrt-broker'), `${org}.json`);
    if (!existsSync(file)) return false;
    return Date.now() - JSON.parse(readFileSync(file, 'utf8')).updatedAt < BROKER_FRESH_MS;
  } catch {
    return false;
  }
}

export function inboxDeliverer({ root, org, cli }) {
  return async ({ ticket, key }) => {
    const { stdout } = await run('node', inboxArgs({ cli, org, ticket, key }), {
      cwd: root,
      timeout: 30_000,
    });
    const last = stdout.trim().split('\n').at(-1) ?? '';
    return JSON.parse(last);
  };
}

const accepted = (r) =>
  r?.delivery === 'live' || (r?.delivery === 'queued' && !OFFLINE_RECEIPT.test(r?.receipt ?? ''));

/** Deliver the plan. Everything that touches the world is injected, so the
 *  schedule can be tested without a daemon. */
export async function runDriver({
  root,
  org,
  schedule,
  truth,
  deliver,
  isUp,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  now = Date.now,
  maxAttempts = 12,
  retryDelayMs = 5_000,
  upPollMs = 2_000,
  upTimeoutMs = 300_000,
}) {
  const logFile = join(root, 'driver-events.jsonl');
  const log = (event) => {
    const tsMs = now();
    appendFileSync(
      logFile,
      `${JSON.stringify({ ts: new Date(tsMs).toISOString(), tsMs, ...event })}\n`,
    );
  };
  const waitStart = now();
  while (!(await isUp())) {
    if (now() - waitStart > upTimeoutMs) {
      log({ event: 'failed', reason: 'the org never came up' });
      throw new Error('the org never came up');
    }
    await sleep(upPollMs);
  }
  const t0 = now();
  const plan = planDeliveries(schedule, truth);
  log({ event: 'start', org, gapSeconds: schedule.gapSeconds, tickets: plan.length });
  for (const item of plan) {
    const wait = t0 + item.offsetSeconds * 1000 - now();
    if (wait > 0) await sleep(wait);
    let ok = false;
    for (let attempt = 1; attempt <= maxAttempts && !ok; attempt++) {
      let result;
      try {
        result = await deliver(item);
      } catch (err) {
        result = { delivery: 'error', receipt: String(err?.message ?? err) };
      }
      ok = accepted(result);
      log({
        event: 'delivery',
        ticket: item.ticket,
        burst: item.burst,
        scheduledOffsetSeconds: item.offsetSeconds,
        attempt,
        ok,
        delivery: result?.delivery,
        receipt: result?.receipt,
      });
      if (!ok && attempt < maxAttempts) await sleep(retryDelayMs);
    }
    if (!ok) {
      log({ event: 'failed', ticket: item.ticket, reason: `no live delivery of ${item.ticket}` });
      throw new Error(`could not deliver ${item.ticket} after ${maxAttempts} attempts`);
    }
  }
  log({ event: 'done' });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [root, org, cli] = process.argv.slice(2).map((p, i) => (i === 1 ? p : resolve(p)));
  const trial = JSON.parse(readFileSync(join(root, 'trial.json'), 'utf8'));
  const inputs = trial.guard[0];
  const read = (f) => JSON.parse(readFileSync(join(inputs, f), 'utf8'));
  try {
    await runDriver({
      root,
      org,
      schedule: read('schedule.json'),
      truth: read('truth.json'),
      isUp: async () => brokerIsUp(org),
      deliver: inboxDeliverer({ root, org, cli }),
    });
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
