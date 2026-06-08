import { createServer } from 'http';
import { setupApiRoutes } from './api.js';
import { getReactUiHtml } from './react-ui.js';
// ── Singleton tracking ────────────────────────────────────────────────────────
let activeServer = null;
let activeUrl = null;
export function isServerRunning() {
    return activeServer !== null;
}
// ── startServer ───────────────────────────────────────────────────────────────
export async function startServer(options) {
    const { db, port = 7374 } = options;
    // Dynamically import express to keep it optional at module load time
    const { default: express } = await import('express');
    const app = express();
    app.use(express.json());
    // DNS rebinding protection: reject requests with a Host header that isn't localhost
    app.use((req, res, next) => {
        const host = (req.headers['host'] ?? '').split(':')[0].toLowerCase();
        if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '') {
            res.status(403).json({ error: 'Forbidden' });
            return;
        }
        next();
    });
    // Mount API routes
    setupApiRoutes(app, db);
    // Serve React SPA
    const reactHtml = getReactUiHtml();
    app.get('/', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(reactHtml);
    });
    app.get('/index.html', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.send(reactHtml);
    });
    const server = createServer(app);
    return new Promise((resolve, reject) => {
        server.on('error', reject);
        server.listen(port, '127.0.0.1', () => {
            const addr = server.address();
            const actualPort = typeof addr === 'object' && addr ? addr.port : port;
            const url = `http://localhost:${actualPort}`;
            activeServer = server;
            activeUrl = url;
            resolve({
                url,
                stop: () => new Promise((res) => {
                    server.close(() => res());
                    if (activeServer === server) {
                        activeServer = null;
                        activeUrl = null;
                    }
                }),
            });
        });
    });
}
export function getActiveUrl() {
    return activeUrl;
}
//# sourceMappingURL=server.js.map