// packages/@monomind/cli/src/orgrt/server.ts
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import type { OrgDaemon } from './daemon.js';

export interface OrgServer { port: number; close: () => void; }

/** Daemon-owned live view: WS fanout of every bus event + tiny REST surface. */
export async function startOrgServer(daemon: OrgDaemon, port: number): Promise<OrgServer> {
  const here = dirname(fileURLToPath(import.meta.url));
  const htmlPath = ['live.html', '../orgrt/live.html']
    .map(p => join(here, p)).find(existsSync) ?? join(here, 'live.html');

  const server = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'GET' && url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(readFileSync(htmlPath, 'utf8'));
    } else if (req.method === 'GET' && url === '/api/orgs') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(daemon.listOrgs().map(o => ({
        name: o.def.name, run: o.run, goal: o.def.goal,
        agents: [...o.agents.entries()].map(([id, a]) => ({ id, usage: a.policy.usage, closed: a.mailbox.isClosed })),
      }))));
    } else if (req.method === 'GET' && url.startsWith('/api/history/')) {
      const name = decodeURIComponent(url.slice('/api/history/'.length));
      const org = daemon.getOrg(name);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(org ? org.busEvents() : []));
    } else {
      res.writeHead(404); res.end('not found');
    }
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const unsubscribe = daemon.subscribe(e => {
    const line = JSON.stringify(e);
    for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(line);
  });

  await new Promise<void>(r => server.listen(port, r));
  const actual = (server.address() as { port: number }).port;
  return { port: actual, close: () => { unsubscribe(); wss.close(); server.close(); } };
}
