// packages/@monomind/cli/src/orgrt/server.ts
// monolean: stripped to xdeliver-only — live UI, WS fanout, and redundant REST
// endpoints deleted; the control server at :4242 handles all of those.
import http from 'node:http';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer {
  port: number;
  close: () => void;
  /** Authorizes the human-decision routes (approvals, gates, answers, human
   *  messages) and, as a superset, everything else. Never published to the
   *  broker registry — see broker.ts's defaultOperatorDir(). */
  operatorCredential: string;
}

/** Routes that act with HUMAN authority. Only the operator credential unlocks
 *  them; a per-org agent credential (the one in the broker registry, readable
 *  by every org process and agent subprocess on the machine) gets 403 so a role
 *  can never approve its own gates. */
const OPERATOR_ROUTES = new Set([
  '/api/set-approval',
  '/api/resolve-gate',
  '/api/answer-question',
  '/api/human-message',
]);

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
    const onError = (err: Error) => {
      req.destroy();
      reject(err);
    };
    req.on('data', (c: string) => {
      // Abort if client disconnected
      if (req.destroyed) {
        onError(new Error('client disconnected'));
        return;
      }
      body += c;
      // Use Buffer.byteLength for accurate multi-byte payload size (fixes DoS vulnerability)
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY) {
        onError(new Error('body too large'));
      }
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}') as Record<string, unknown>);
      } catch {
        reject(new Error('invalid JSON'));
      }
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
 *  Two credentials gate requests: each hosted org's agent credential (published
 *  via the broker; unlocks delivery/status routes) and the operator credential
 *  (generated here unless supplied; unlocks OPERATOR_ROUTES as well). */
export async function startOrgServer(
  daemon: OrgDaemon,
  port = 0,
  operatorCredential?: string,
): Promise<OrgServer> {
  const { randomUUID, timingSafeEqual } = await import('node:crypto');
  const operatorCred = operatorCredential ?? randomUUID();

  // SEC-2: timing-safe credential comparison. The previous `!==` compared
  // header-supplied bytes against the secret byte-for-byte and short-circuited
  // on the first mismatched character — a remote attacker could time the
  // response to recover the secret one byte at a time. Buffer.from + length
  // gate + timingSafeEqual runs in constant time.
  const safeEq = (supplied: unknown, expected: string): boolean => {
    const a = Buffer.from(String(supplied ?? ''));
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  };
  const isOperator = (supplied: unknown): boolean => safeEq(supplied, operatorCred);
  /** Operator, or any org currently hosted by this daemon. */
  const isAgentOrOperator = (supplied: unknown): boolean => {
    if (isOperator(supplied)) return true;
    for (const org of daemon.orgs.values())
      if (org.credential && safeEq(supplied, org.credential)) return true;
    return false;
  };

  // SEC-3: DNS-rebinding / cross-origin defence. Mirrors ui/server.mjs's
  // _allowedHosts + Origin allow-list. Default to loopback; override via env
  // for users running the daemon behind a port-forwarder or in a container.
  const ALLOWED_HOSTS = new Set(
    process.env.MONOMIND_ORG_SERVER_ALLOWED_HOSTS?.split(',').filter(Boolean).length
      ? process.env.MONOMIND_ORG_SERVER_ALLOWED_HOSTS?.split(',').map((s) => s.trim())
      : ['localhost', '127.0.0.1', '::1'],
  );

  // The actual bound port is unknown until after listen() resolves (an
  // ephemeral `port: 0` request returns the kernel-assigned port). The
  // request handler closes over `actualPort` and re-reads it per request.
  let actualPort = port;
  const allowedOrigin = (origin: string | undefined): string | undefined => {
    if (!origin) return undefined;
    const set = new Set([
      `http://localhost:${actualPort}`,
      `http://127.0.0.1:${actualPort}`,
      `http://[::1]:${actualPort}`,
    ]);
    return set.has(origin) ? origin : undefined;
  };

  const sseClients = new Set<http.ServerResponse>();

  const server = http.createServer((req, res) => {
    // SEC-3: Host-header loopback check. Defeats DNS-rebinding: a malicious
    // domain can resolve to 127.0.0.1 but the browser will send its own
    // hostname in Host. Reject before any auth logic runs.
    const reqHost = (req.headers.host ?? '').split(':')[0];
    if (!ALLOWED_HOSTS.has(reqHost)) {
      json(res, 403, { ok: false, error: 'forbidden: host not allowed' });
      return;
    }
    const corsOrigin = allowedOrigin(req.headers.origin);

    // SSE endpoint for live bus event streaming (dashboard integration)
    if (req.method === 'GET' && req.url === '/api/events') {
      if (!isAgentOrOperator(req.headers['x-monomind-cred'])) {
        json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const headers: Record<string, string> = {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      };
      // SEC-3: only echo the Origin when it's this server's own loopback
      // origin. Omit entirely otherwise so the browser blocks the read.
      if (corsOrigin) headers['Access-Control-Allow-Origin'] = corsOrigin;
      res.writeHead(200, headers);
      res.write('data: {"type":"connected"}\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    // GET endpoint for org status snapshot (dashboard initial load)
    if (req.method === 'GET' && req.url?.startsWith('/api/status')) {
      if (!isAgentOrOperator(req.headers['x-monomind-cred'])) {
        json(res, 401, { ok: false, error: 'unauthorized' });
        return;
      }
      const snapshot = daemon.getStatusSnapshot?.();
      json(res, 200, snapshot ?? { orgs: [] });
      return;
    }

    if (req.method !== 'POST') {
      res.writeHead(404);
      res.end('not found');
      return;
    }

    // Auth gate — every POST needs a credential this daemon recognizes, and
    // the human-decision routes need the operator credential specifically.
    const supplied = req.headers['x-monomind-cred'];
    if (!isAgentOrOperator(supplied)) {
      json(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }
    if (OPERATOR_ROUTES.has(req.url ?? '') && !isOperator(supplied)) {
      json(res, 403, { ok: false, error: 'forbidden: operator credential required' });
      return;
    }

    (async () => {
      const payload = await parseBody(req);

      if (req.url === '/api/xdeliver') {
        const {
          toOrg,
          toRole,
          fromOrg,
          fromRole,
          fromCredential,
          subject,
          body: b,
        } = payload as Record<string, string | undefined>;
        if (!toOrg || !toRole || !fromOrg || !fromRole) {
          json(res, 400, { ok: false, error: 'toOrg, toRole, fromOrg, fromRole are required' });
          return;
        }
        const result = await daemon.receiveRemote(
          toOrg,
          toRole,
          `${fromOrg}:${fromRole}`,
          subject ?? '',
          b ?? '',
          fromCredential,
        );
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
        const result = await daemon.resolveGate(
          org as string,
          gateId as string,
          !!approved,
          resolution as string | undefined,
        );
        json(res, result.ok ? 200 : 404, result);
      } else if (req.url === '/api/set-approval') {
        const { org, role, action, approved } = payload as Record<string, unknown>;
        if (!org || !role || !action || approved === undefined) {
          json(res, 400, { ok: false, error: 'org, role, action, approved are required' });
          return;
        }
        const result = await daemon.setApproval(
          org as string,
          role as string,
          action as string,
          !!approved,
        );
        json(res, result.ok ? 200 : 404, result);
      } else {
        json(res, 404, { ok: false, error: 'not found' });
      }
    })().catch((err) => {
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
  await new Promise<void>((resolve, reject) => {
    const onError = (err: Error) => reject(err);
    server.once('error', onError);
    server.listen(port, bindHost, () => {
      server.removeListener('error', onError);
      resolve();
    });
  });
  const actual = (server.address() as { port: number }).port;
  actualPort = actual;

  // Wire bus events from all running orgs to SSE clients
  daemon.onBusEvent?.((event) => {
    if (sseClients.size === 0) return;
    const data = JSON.stringify(event);
    for (const client of sseClients) {
      try {
        client.write(`data: ${data}\n\n`);
      } catch {
        sseClients.delete(client);
      }
    }
  });

  return {
    port: actual,
    close: () => {
      for (const c of sseClients) c.end();
      sseClients.clear();
      server.close();
    },
    operatorCredential: operatorCred,
  };
}
