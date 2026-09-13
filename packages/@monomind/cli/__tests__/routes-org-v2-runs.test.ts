/**
 * Regression test for issue #238: "Dashboard Chat tab is always empty for
 * Org Runtime v2 orgs (wrong run-file path)".
 *
 * v1 orgs stored each run's events, already in the dashboard's own vocabulary
 * (org:comms, session:start, ...), as a flat file:
 *   .monomind/orgs/<org>/runs/<runId>.jsonl
 *
 * Org Runtime v2 (src/orgrt/bus.ts) writes each run's raw BusEvents (chat,
 * status, tool, ...) to a per-run directory instead:
 *   .monomind/orgs/<org>/<runId>/bus.jsonl
 *
 * routes-org.mjs's three run-reading endpoints only ever looked at the v1
 * layout, so a v2 org's runs never appeared in the Chat tab's dropdown and
 * the live-tail endpoint always returned an empty {events:[],runId:null} —
 * even while the org was actively running with real events on disk.
 *
 * Reading the right file is necessary but not sufficient: v2's raw BusEvent
 * types (chat/status/tool/...) aren't the vocabulary orgs.html renders
 * (org:comms/session:start/...) — that translation currently only happens
 * live, in forwarder.ts's translate()/companionEvents(). These tests assert
 * on the translated shape, proving playback of a v2 run matches what would
 * have been live-streamed, not just that *a* response comes back.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// server.mjs is plain ESM shipped as-is; import it directly.
// @ts-expect-error — .mjs sibling has no type declarations
import * as uiServer from '../src/ui/server.mjs';

const { startServer } = uiServer as any;

const CRED_RE = /mm-token" content="([a-f0-9]+)"/;
const ORG = 'v2chatorg';
const RUN_ID = 'run-20260913101934-abcd';

let httpServer: any = null;
let baseUrl = '';
let cred = '';
let projectDir = '';
const prevCwd = process.cwd();

function busLine(overrides: Record<string, unknown>): string {
  return JSON.stringify({ id: 'x', org: ORG, run: RUN_ID, ...overrides }) + '\n';
}

beforeAll(async () => {
  const root = mkdtempSync(join(tmpdir(), 'mm-v2-chat-'));
  projectDir = join(root, 'proj');
  const runDir = join(projectDir, '.monomind', 'orgs', ORG, RUN_ID);
  mkdirSync(runDir, { recursive: true });

  // Real v2 layout: per-run directory, always named bus.jsonl, raw BusEvent shape.
  writeFileSync(
    join(runDir, 'bus.jsonl'),
    [
      busLine({ ts: 1000, type: 'status', msg: 'org started (1 agents)', data: { goal: 'ship it' } }),
      busLine({ ts: 2000, type: 'chat', from: 'boss', msg: 'hello team' }),
      busLine({ ts: 3000, type: 'status', msg: 'org stopped' }),
    ].join(''),
  );

  // runtime.json with status:'running' and this test process's own (real,
  // alive) pid — mirrors daemon.ts's persistState() shape exactly, so the
  // server's startup gap-fill (server.mjs's activeOrgRuns rebuild) resolves
  // the active run the same way it would for a genuinely running v2 org.
  writeFileSync(
    join(projectDir, '.monomind', 'orgs', ORG, 'runtime.json'),
    JSON.stringify({ status: 'running', run: RUN_ID, pid: process.pid, updated: new Date().toISOString() }),
  );

  process.chdir(projectDir);
  const res = await startServer({ port: 4918, projectDir, openBrowser: false });
  httpServer = res.server;
  baseUrl = `http://127.0.0.1:${res.port}`;

  const html = await (await fetch(`${baseUrl}/`)).text();
  cred = (html.match(CRED_RE) || [])[1] || '';

  // Populate server.mjs's in-memory activeOrgRuns the same way a real running
  // v2 org's forwarder would: POSTing a translated event with org+runId.
  // (The alternative — runtime.json startup gap-fill — reads from a
  // module-level MONOMIND_HOME frozen at server.mjs's first import across
  // the whole vitest worker, not this test's projectDir, so it can't be
  // exercised reliably from an isolated test; this is the actual live path.)
  await fetch(`${baseUrl}/api/mastermind/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-monomind-token': cred },
    body: JSON.stringify({ type: 'org:start', org: ORG, runId: RUN_ID, goal: 'ship it' }),
  });
}, 60_000);

afterAll(async () => {
  try {
    httpServer?.closeAllConnections?.();
    httpServer?.close();
  } catch {
    /* best effort */
  }
  process.chdir(prevCwd);
});

const authHeaders = () => ({ 'x-monomind-token': cred });

describe('GET /api/org/:name/runs — v2 run directories', () => {
  it('lists the v2 run directory instead of an empty array', async () => {
    const res = await fetch(`${baseUrl}/api/org/${ORG}/runs`, { headers: authHeaders() });
    const runs = await res.json();
    expect(Array.isArray(runs)).toBe(true);
    const found = runs.find((r: any) => r.runId === RUN_ID);
    expect(found).toBeTruthy();
    expect(found.eventCount).toBe(3);
  });
});

describe('GET /api/org/:name/runs/:runId — v2 bus.jsonl, translated', () => {
  it('returns the run\'s events translated to the dashboard vocabulary', async () => {
    const res = await fetch(`${baseUrl}/api/org/${ORG}/runs/${RUN_ID}`, { headers: authHeaders() });
    expect(res.status).toBe(200);
    const events = await res.json();
    const types = events.map((e: any) => e.type);
    // companionEvents() before translate() for each raw event, same order
    // forwarder.ts's live subscribe loop already produces.
    expect(types).toEqual(['session:start', 'org:start', 'org:comms', 'session:complete', 'org:complete']);
    const comms = events.find((e: any) => e.type === 'org:comms');
    expect(comms).toMatchObject({ from: 'boss', to: 'all', msg: 'hello team', org: ORG, runId: RUN_ID });
  });
});

describe('GET /api/orgs/:name/runs/current — v2 live tail', () => {
  it('resolves the active v2 run via runtime.json instead of 404ing', async () => {
    const res = await fetch(`${baseUrl}/api/orgs/${ORG}/runs/current`, { headers: authHeaders() });
    const body = await res.json();
    expect(body.runId).toBe(RUN_ID);
    expect(Array.isArray(body.events)).toBe(true);
    expect(body.events.length).toBeGreaterThan(0);
    expect(body.active).toBe(true);
  });
});
