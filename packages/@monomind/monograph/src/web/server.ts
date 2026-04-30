import { createServer } from 'http';
import type { Server } from 'http';
import type Database from 'better-sqlite3';
import { setupApiRoutes } from './api.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServerOptions {
  port?: number;
  db: Database.Database;
}

export interface ServerHandle {
  url: string;
  stop: () => void;
}

// ── Singleton tracking ────────────────────────────────────────────────────────

let activeServer: Server | null = null;
let activeUrl: string | null = null;

export function isServerRunning(): boolean {
  return activeServer !== null;
}

// ── startServer ───────────────────────────────────────────────────────────────

export async function startServer(options: ServerOptions): Promise<ServerHandle> {
  const { db, port = 7374 } = options;

  // Dynamically import express to keep it optional at module load time
  const { default: express } = await import('express');
  const { fileURLToPath } = await import('url');
  const { join, dirname } = await import('path');

  const app = express();
  app.use(express.json());

  // Mount API routes
  setupApiRoutes(app, db);

  // Serve UI static file
  const __filename = fileURLToPath(import.meta.url);
  const __dir = dirname(__filename);
  const htmlPath = join(__dir, 'ui', 'index.html');
  app.get('/', (_req, res) => {
    res.sendFile(htmlPath);
  });

  const server = createServer(app);

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      activeServer = server;
      activeUrl = url;

      resolve({
        url,
        stop: () => {
          server.close();
          if (activeServer === server) {
            activeServer = null;
            activeUrl = null;
          }
        },
      });
    });
  });
}

export function getActiveUrl(): string | null {
  return activeUrl;
}
