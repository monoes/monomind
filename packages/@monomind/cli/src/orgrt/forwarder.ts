// packages/@monomind/cli/src/orgrt/forwarder.ts

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OrgBus } from './bus.js';
import type { BusEvent } from './types.js';

/**
 * Forwards every bus event to the running mastermind control server
 * (src/ui/server.mjs, POST /api/mastermind/event) so the existing
 * dashboard shows org activity. Best-effort: failures are dropped.
 *
 * Events are translated into the dashboard's native vocabulary
 * (org:start / org:comms / org:agent:online|offline / org:artifact /
 * org:checkpoint / org:complete) so the Orgs panel and Chat tab render
 * them; every payload carries org + runId so the server routes it to the
 * run file. Event kinds without a native rendering (tool/usage/audit) are
 * forwarded as raw org:<type> — they still land in the run file and SSE.
 *
 * companionEvents() additionally emits session:start/session:complete: the
 * dashboard's client-side Chat tab only lists a run in its session dropdown
 * once it has seen a session:start for that session id — org:start alone is
 * NOT enough (verified against src/ui/orgs.html's handleMmEvent, which
 * creates the chatSessions entry solely on session:start). Companions are
 * sent before the primary translate() payload for the same bus event so the
 * client-side session record exists before anything tries to append to it.
 *
 * sessionId() below joins org/run with "__", not ":" — server.mjs's
 * per-session persistence (data/sessions/<id>.jsonl + _index.json, the store
 * GET /api/mastermind/sessions reads on page load) validates the session id
 * against /^(?!.*\.\.)[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/, which rejects colons. A
 * colon-joined id silently fails that check — the event still lands in the
 * raw mastermind-events.jsonl log, but the run never persists to the session
 * index, so a fresh dashboard load never lists it (only a client that was
 * already connected via SSE when session:start fired would show it).
 */
function sessionId(org: string, run: string): string {
  return `${org}__${run}`;
}

/** Classifies a 'status' bus event's free-text msg — shared by companionEvents() and translate() so the two don't drift on what counts as start/stop. */
type StatusKind = 'started' | 'stopped' | 'other';
function classifyStatus(msg: string): StatusKind {
  if (msg.startsWith('org started')) return 'started';
  if (msg === 'org stopped') return 'stopped';
  return 'other';
}
// Module-level single-flight so multiple orgs in one daemon don't double-spawn.
const healAttempted = new Set<string>();

export function attachForwarder(bus: OrgBus, controlJsonPath = '.monomind/control.json') {
  let chain: Promise<void> = Promise.resolve();
  let warnedNoDashboard = false;
  const isPidAlive = (pid: unknown): boolean => {
    if (!Number.isInteger(pid) || (pid as number) <= 0) return true; // 0/absent = unknown, assume alive
    try {
      process.kill(pid as number, 0);
      return true;
    } catch (err) {
      return (err as NodeJS.ErrnoException).code === 'EPERM'; // EPERM = exists, no permission
    }
  };
  const baseUrl = (): string | null => {
    try {
      if (!existsSync(controlJsonPath)) return null;
      const c = JSON.parse(readFileSync(controlJsonPath, 'utf8'));
      if (!isPidAlive(c.pid)) return null; // recorded server is dead — same as no dashboard
      return typeof c.url === 'string' ? c.url : `http://localhost:${c.port ?? 4242}`;
    } catch {
      return null;
    }
  };

  // ── Self-heal (#136): if control.json is missing (or its server dead), the
  // SessionStart hook either never ran or failed. Spawn the dashboard server
  // detached ourselves — same contract control-start.cjs uses: server.mjs
  // takes the port positionally, reports its actual bound port + pid via
  // MONOMIND_BOUND_REPORT, and we write control.json so baseUrl() resolves.
  // Single-flight per control.json path; skipped in tests/CI via the same
  // MONOMIND_CONTROL_NO_SPAWN escape hatch control-start's tests use.
  const healDashboard = async (): Promise<void> => {
    if (process.env.MONOMIND_CONTROL_NO_SPAWN === '1' || process.env.NODE_ENV === 'test') return;
    if (!healAttempted.has(controlJsonPath)) {
      healAttempted.add(controlJsonPath);
      try {
        const serverPath = fileURLToPath(new URL('../ui/server.mjs', import.meta.url));
        if (!existsSync(serverPath)) return;
        const projectDir = dirname(dirname(controlJsonPath));
        const reportPath = join(
          dirname(controlJsonPath),
          `.bound-report-orgrt-${process.pid}.json`,
        );
        const child = spawn(process.execPath, [serverPath, '4242'], {
          detached: true,
          stdio: 'ignore',
          cwd: projectDir,
          env: {
            ...process.env,
            CLAUDE_PROJECT_DIR: projectDir,
            MONOMIND_BOUND_REPORT: reportPath,
          },
        });
        child.on('error', () => {
          /* best-effort — warning above already fired */
        });
        child.unref();
        for (let i = 0; i < 50 && !existsSync(reportPath); i++)
          await new Promise((r) => setTimeout(r, 200));
        if (!existsSync(reportPath)) return;
        const { pid, port } = JSON.parse(readFileSync(reportPath, 'utf8'));
        unlinkSync(reportPath);
        mkdirSync(dirname(controlJsonPath), { recursive: true });
        writeFileSync(
          controlJsonPath,
          JSON.stringify({
            pid,
            port,
            url: `http://localhost:${port}`,
            startedAt: new Date().toISOString(),
          }),
        );
      } catch {
        /* best-effort */
      }
    }
  };

  // src/ui/server.mjs's startServer() writes a per-process auth credential
  // to 'dashboard-token' next to control.json (same .monomind dir) and requires
  // it via a header on every non-GET request. Read fresh each POST since the
  // credential rotates whenever the server restarts.
  const readAuthCredential = (): string | null => {
    try {
      return readFileSync(join(dirname(controlJsonPath), 'dashboard-token'), 'utf8').trim();
    } catch {
      return null;
    }
  };

  const post = async (url: string, payload: Record<string, unknown>): Promise<void> => {
    const credential = readAuthCredential();
    await fetch(`${url}/api/mastermind/event`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(credential ? { 'x-monomind-token': credential } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(3000),
    })
      .then((r) => {
        r.body?.cancel();
      })
      .catch(() => {});
  };

  const unsubscribe = bus.subscribe((e: BusEvent) => {
    chain = chain
      .then(async () => {
        const url = baseUrl();
        if (!url) {
          if (!warnedNoDashboard) {
            warnedNoDashboard = true;
            console.warn(
              `[orgrt] No live dashboard (missing/dead ${controlJsonPath}) — org events will not appear on the Neural Control Room. Starting one; or run "monomind ui" manually.`,
            );
          }
          // First no-dashboard event waits for the (single-flight) heal so the
          // org:start/session:start companions aren't lost if a server comes up;
          // later events skip straight through once healAttempted is set.
          await healDashboard();
          const healedUrl = baseUrl();
          if (!healedUrl) return;
          for (const payload of companionEvents(e)) await post(healedUrl, payload);
          await post(healedUrl, translate(e));
          return;
        }
        for (const payload of companionEvents(e)) await post(url, payload);
        await post(url, translate(e));
      })
      .catch(() => {});
  });

  return { settle: () => chain, unsubscribe };
}

const TEXTUAL_EXT = new Set([
  '.md',
  '.txt',
  '.json',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.py',
  '.sh',
  '.yaml',
  '.yml',
  '.html',
  '.css',
  '.xml',
  '.log',
  '.csv',
]);
function guessMimeType(path: string | undefined): string {
  if (!path) return 'application/octet-stream';
  return TEXTUAL_EXT.has(extname(path).toLowerCase()) ? 'text/plain' : 'application/octet-stream';
}

/**
 * Companion dashboard events a single bus event needs beyond its primary
 * translate() mapping. Currently: org-started -> session:start (registers
 * the run in the client's session list) and org-stopped -> session:complete.
 * Exported for tests.
 */
export function companionEvents(e: BusEvent): Record<string, unknown>[] {
  if (e.type !== 'status') return [];
  const base = { session: sessionId(e.org, e.run), org: e.org, ts: e.ts };
  const msg = e.msg ?? '';
  const kind = classifyStatus(msg);
  if (kind === 'started') {
    const goal = (e.data as { goal?: string } | undefined)?.goal;
    return [{ ...base, type: 'session:start', prompt: goal?.length ? goal : e.org }];
  }
  if (kind === 'stopped') {
    return [{ ...base, type: 'session:complete', status: 'complete', domains: ['ops'] }];
  }
  return [];
}

/** BusEvent → dashboard-native mastermind event. Exported for tests. */
export function translate(e: BusEvent): Record<string, unknown> {
  const base = {
    org: e.org,
    runId: e.run,
    session: sessionId(e.org, e.run),
    domain: 'ops',
    ts: e.ts,
  };
  switch (e.type) {
    case 'chat':
      return { ...base, type: 'org:comms', from: e.from, to: 'all', msg: e.msg };
    case 'message':
    case 'xorg':
      return {
        ...base,
        type: 'org:comms',
        from: e.from,
        to: e.to,
        msg: e.subject ? `[${e.subject}] ${e.msg ?? ''}` : e.msg,
      };
    case 'asset': {
      // content (when PolicyEngine captured a Write snapshot) rides along so the
      // dashboard can diff this exact version later instead of only ever seeing
      // whatever is currently on disk at `path`.
      const content = (e.data as { content?: string } | undefined)?.content;
      return {
        ...base,
        type: 'org:artifact',
        from: e.from,
        artifact: {
          label: basename(e.path ?? 'asset'),
          type: 'file',
          path: e.path,
          mimeType: guessMimeType(e.path),
          ...(content !== undefined ? { content } : {}),
        },
      };
    }
    case 'question': {
      const q = (e.data as { questionId?: string; question?: string } | undefined) ?? {};
      return {
        ...base,
        type: 'org:question',
        from: e.from,
        questionId: q.questionId,
        question: q.question,
      };
    }
    case 'status': {
      const msg = e.msg ?? '';
      const kind = classifyStatus(msg);
      if (kind === 'started')
        return {
          ...base,
          type: 'org:start',
          goal: (e.data as { goal?: string } | undefined)?.goal ?? '',
        };
      if (kind === 'stopped') return { ...base, type: 'org:complete' };
      if (msg === 'session starting')
        return {
          ...base,
          type: 'org:agent:online',
          role: e.from,
          title: e.from,
          agent_type: e.from,
        };
      if (msg === 'session ended' || msg.startsWith('session error'))
        return { ...base, type: 'org:agent:offline', from: e.from, reason: msg };
      return { ...base, type: 'org:checkpoint', progress: msg, from: e.from };
    }
    default:
      // tool / usage / audit — no native widget; keep raw for run file + SSE
      return { ...e, ...base, type: `org:${e.type}` };
  }
}
