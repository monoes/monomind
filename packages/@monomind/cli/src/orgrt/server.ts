// packages/@monomind/cli/src/orgrt/server.ts
// monolean: stripped to xdeliver-only — live UI, WS fanout, and redundant REST
// endpoints deleted; the control server at :4242 handles all of those.
import http from 'node:http';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer { port: number; close: () => void; }

/** Minimal HTTP listener for cross-process org message delivery.
 *  Binds an ephemeral port (pass 0) so the daemon can register it with the broker. */
export async function startOrgServer(daemon: OrgDaemon, port = 0): Promise<OrgServer> {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/xdeliver') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        try {
          const payload = JSON.parse(body || '{}') as {
            toOrg?: string; toRole?: string; fromOrg?: string; fromRole?: string; subject?: string; body?: string;
          };
          if (!payload.toOrg || !payload.toRole || !payload.fromOrg || !payload.fromRole) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'toOrg, toRole, fromOrg, fromRole are required' }));
            return;
          }
          const result = daemon.receiveRemote(
            payload.toOrg, payload.toRole, `${payload.fromOrg}:${payload.fromRole}`,
            payload.subject ?? '', payload.body ?? '',
          );
          res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'bad request' }));
        }
      });
    } else if (req.method === 'POST' && req.url === '/api/human-message') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        (async () => {
          try {
            const payload = JSON.parse(body || '{}') as { org?: string; role?: string; text?: string };
            if (!payload.org || !payload.role || !payload.text) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'org, role, text are required' }));
              return;
            }
            const receipt = await daemon.deliver(payload.org, 'human', payload.role, 'message from human', payload.text);
            const ok = !receipt.startsWith('ERROR:');
            res.writeHead(ok ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok, receipt }));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'bad request' }));
          }
        })();
      });
      return;
    } else if (req.method === 'POST' && req.url === '/api/answer-question') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        (async () => {
          try {
            const payload = JSON.parse(body || '{}') as {
              org?: string; role?: string; questionId?: string; answer?: string;
            };
            if (!payload.org || !payload.role || !payload.questionId || payload.answer === undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'org, role, questionId, answer are required' }));
              return;
            }
            const result = await daemon.answerQuestion(payload.org, payload.role, payload.questionId, payload.answer);
            res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'bad request' }));
          }
        })();
      });
      return;
    } else {
      res.writeHead(404); res.end('not found');
    }
  });

  await new Promise<void>(r => server.listen(port, r));
  const actual = (server.address() as { port: number }).port;
  return { port: actual, close: () => { server.close(); } };
}
