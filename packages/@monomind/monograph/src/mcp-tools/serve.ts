import type Database from 'better-sqlite3';
import { startServer, isServerRunning, getActiveUrl } from '../web/server.js';

export interface ServeOptions {
  port?: number;
  open?: boolean;
  db: Database.Database;
}

export interface ServeResult {
  url: string;
  status: 'started' | 'already_running';
}

/**
 * Start the Monograph web UI server.
 * If the server is already running, returns the existing URL.
 */
export async function serveMonograph(options: ServeOptions): Promise<ServeResult> {
  const { port = 7374, open = false, db } = options;

  if (isServerRunning()) {
    const url = getActiveUrl() ?? `http://localhost:${port}`;
    return { url, status: 'already_running' };
  }

  const handle = await startServer({ port, db });

  if (open) {
    const { exec } = await import('child_process');
    const cmd = process.platform === 'win32'
      ? `start "" "${handle.url}"`
      : process.platform === 'darwin'
        ? `open "${handle.url}"`
        : `xdg-open "${handle.url}"`;
    exec(cmd);
  }

  return { url: handle.url, status: 'started' };
}
