// packages/@monomind/cli/src/orgrt/server.ts
// monolean: stripped to xdeliver-only — live UI, WS fanout, and redundant REST
// endpoints deleted; the control server at :4242 handles all of those.
import http from 'node:http';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer { port: number; close: () => void; credential: string }

// CLI options for server behavior (currently unused but reserved for future CLI flags)
export interface ServerOpts {
  /** Filter tool audit events by tool name or decision (allow|deny) */
  auditFilter?: { tool?: string; decision?: 'allow' | 'deny' };
}

const MAX_BODY = 1_000_000; // 1MB — prevents OOM from oversized POSTs

/** Parse a JSON POST body with a size guard. Rejects oversized or malformed bodies. */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    const onError = (err: Error) => { req.destroy(); reject(err); };
    req.on('data', (c: string) => {
      // Abort if client disconnected
      if (req.destroyed) { onError(new Error('client disconnected')); return; }
      body += c;
      // Use Buffer.byteLength for accurate multi-byte payload size (fixes DoS vulnerability)
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY) { onError(new Error('body too large')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}') as Record<string, unknown>); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', onError);
  });
}

function json(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/** Minimal HTTP listener for cross-process org message delivery.
 *  Binds an ephemeral port (pass 0) so the daemon can register it with the broker.
 *  Requires an auth credential on all POST requests (generated at startup, shared via broker). */
export async function startOrgServer(daemon: OrgDaemon, port = 0, credential?: string): Promise<OrgServer> {
  const { randomUUID } = await import('node:crypto');
  const cred = credential ?? randomUUID();

  const sseClients = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    // SSE endpoint for live bus event streaming (dashboard integration)
    if (req.method === 'GET' && req.url === '/api/events') {
      if (req.headers['x-monomind-cred'] !== cred) { json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*',
      });
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // GET endpoint for org status snapshot (dashboard initial load)
    if (req.method === 'GET' && req.url?.startsWith('/api/status')) {
      if (req.headers['x-monomind-cred'] !== cred) { json(res, 401, { ok: false, error: 'unauthorized' }); return; }
      const snapshot = daemon.getStatusSnapshot?.();
      json(res, 200, snapshot ?? { orgs: [] });
      return;
    }

    if (req.method !== 'POST') { res.writeHead(404); res.end('not found'); return; }

    // Auth gate — all POST endpoints require the daemon credential
    if (req.headers['x-monomind-cred'] !== cred) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    (async () => {
      const payload = await parseBody(req);

      if (req.url === '/api/xdeliver') {
        const { toOrg, toRole, fromOrg, fromRole, subject, body: b } = payload as Record<string, string | undefined>;
        if (!toOrg || !toRole || !fromOrg || !fromRole) {
          json(res, 400, { ok: false, error: 'toOrg, toRole, fromOrg, fromRole are required' });
          return;
        }
        const result = daemon.receiveRemote(toOrg, toRole, `${fromOrg}:${fromRole}`, subject ?? '', b ?? '');
        json(res, result.ok ? 200 : 404, result);

      } else if (req.url === '/api/human-message') {
        const { org, role, text } = payload as Record<string, string | undefined>;
        if (!org || !role || !text) {
          json(res, 400, { ok: false, error: 'org, role, text are required' });
          return;
        }
        const receipt = await daemon.deliver(org, 'human', role, 'message from human', text);
        const ok = !receipt.startsWith('ERROR:');
        json(res, ok ? 200 : 404, { ok, receipt });

      } else if (req.url === '/api/answer-question') {
        const { org, role, questionId, answer } = payload as Record<string, string | undefined>;
        if (!org || !role || !questionId || answer === undefined) {
          json(res, 400, { ok: false, error: 'org, role, questionId, answer are required' });
          return;
        }
        const result = await daemon.answerQuestion(org, role, questionId, answer!);
        json(res, result.ok ? 200 : 404, result);

      } else if (req.url === '/api/resolve-gate') {
        const { org, gateId, approved, resolution } = payload as Record<string, unknown>;
        if (!org || !gateId || approved === undefined) {
          json(res, 400, { ok: false, error: 'org, gateId, approved are required' });
          return;
        }
        const result = await daemon.resolveGate(org as string, gateId as string, !!approved, resolution as string | undefined);
        json(res, result.ok ? 200 : 404, result);

      } else {
        json(res, 404, { ok: false, error: 'not found' });
      }
    })().catch(err => {
      json(res, 400, { ok: false, error: err instanceof Error ? err.message : 'bad request' });
    });
  });

  // Q6: bind to 127.0.0.1 explicitly. Without a host arg Node binds to
  // `::` / `0.0.0.0`; even though endpoints require a credential, binding
  // loopback-only prevents same-LAN credential recovery via process
  // inspection and shrinks the attack surface. Override via env var for
  // users running inside containers / port-forwarders that genuinely need
  // remote connections.
  const bindHost = process.env.MONOMIND_ORG_SERVER_HOST ?? '127.0.0.1';
  await new Promise<void>(r => server.listen(port, bindHost, r));
  const actual = (server.address() as { port: number }).port;

  // Wire bus events from all running orgs to SSE clients
  daemon.onBusEvent?.((event) => {
    if (sseClients.size === 0) return;
    const data = JSON.stringify(event);
    for (const client of sseClients) {
      try { client.write(`data: ${data}\n\n`); } catch { sseClients.delete(client); }
    }
  });

  return { port: actual, close: () => { for (const c of sseClients) c.end(); sseClients.clear(); server.close(); }, credential: cred };
}
