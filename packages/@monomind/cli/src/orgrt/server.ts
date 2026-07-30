// packages/@monomind/cli/src/orgrt/server.ts
// monolean: stripped to xdeliver-only — live UI, WS fanout, and redundant REST
// endpoints deleted; the control server at :4242 handles all of those.
import http from 'node:http';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer { port: number; close: () => void; credential: string }

const MAX_BODY = 1_000_000; // 1MB — prevents OOM from oversized POSTs

/** Parse a JSON POST body with a size guard. Rejects oversized or malformed bodies. */
function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c: string) => {
      body += c;
      // Use Buffer.byteLength for accurate multi-byte payload size (fixes DoS vulnerability)
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY) { req.destroy(); reject(new Error('body too large')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}') as Record<string, unknown>); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
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

  const server = http.createServer((req, res) => {
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

      } else {
        json(res, 404, { ok: false, error: 'not found' });
      }
    })().catch(err => {
      json(res, 400, { ok: false, error: err instanceof Error ? err.message : 'bad request' });
    });
  });

  await new Promise<void>(r => server.listen(port, r));
  const actual = (server.address() as { port: number }).port;
  return { port: actual, close: () => { server.close(); }, credential: cred };
}
