import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 4242;
let instance = null;
export function getDashboardServer(port = DEFAULT_PORT) {
    if (instance)
        return instance;
    const recentRuns = [];
    const clients = new Set();
    const htmlPath = join(__dirname, 'ui.html');
    const httpServer = createServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/') {
            try {
                const html = await readFile(htmlPath, 'utf8');
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(html);
            }
            catch {
                res.writeHead(500);
                res.end('Dashboard UI not found');
            }
            return;
        }
        if (req.method === 'GET' && req.url === '/runs') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(recentRuns));
            return;
        }
        if (req.method === 'POST' && req.url === '/api/mastermind/event') {
            const chunks = [];
            req.on('data', (chunk) => chunks.push(chunk));
            req.on('end', () => {
                try {
                    const body = Buffer.concat(chunks).toString('utf8');
                    JSON.parse(body); // validate before broadcast
                    for (const client of clients) {
                        if (client.readyState === client.OPEN)
                            client.send(body);
                    }
                }
                catch { }
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end('{"ok":true}');
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });
    const wss = new WebSocketServer({ server: httpServer });
    wss.on('connection', (ws) => {
        clients.add(ws);
        // Send recent state on connect
        ws.send(JSON.stringify({ type: 'init', runs: recentRuns }));
        ws.on('close', () => clients.delete(ws));
        ws.on('error', () => clients.delete(ws));
    });
    httpServer.listen(port);
    instance = {
        port,
        broadcast(event) {
            const msg = JSON.stringify(event);
            for (const client of clients) {
                if (client.readyState === client.OPEN)
                    client.send(msg);
            }
        },
        close() {
            httpServer.close();
            wss.close();
            instance = null;
        },
    };
    return instance;
}
//# sourceMappingURL=server.js.map