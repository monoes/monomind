/**
 * Browse Platform Command — Manage platform connections (LinkedIn, Instagram, X, Gemini)
 * Sessions stored as JSON at ~/.monomind/sessions.json
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getAdapter } from '../browser/adapters/index.js';

const CDP_PORT = Number(process.env['MONOMIND_CDP_PORT'] ?? 9222);

const SESSIONS_FILE = join(homedir(), '.monomind', 'sessions.json');

interface Session {
  id: string;          // "platform:username"
  platform: string;
  username: string;
  cookies: string;     // JSON-serialized
  userAgent: string;
  createdAt: number;
  lastUsedAt: number;
}

async function loadSessions(): Promise<Session[]> {
  if (!existsSync(SESSIONS_FILE)) return [];
  try {
    const raw = await readFile(SESSIONS_FILE, 'utf-8');
    return JSON.parse(raw) as Session[];
  } catch {
    return [];
  }
}

async function saveSessions(sessions: Session[]): Promise<void> {
  await mkdir(join(homedir(), '.monomind'), { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  // Restrict to owner-only (rw-------) since the file contains platform session cookies.
  await chmod(SESSIONS_FILE, 0o600);
}

export function createPlatformCommand(): Command {
  const cmd = new Command('platform').description('Manage platform connections');

  cmd
    .command('connect <platform>')
    .description('Connect a platform account via browser — opens Chrome, waits for login, saves session')
    .option('--port <number>', 'CDP port of running Chrome instance', String(CDP_PORT))
    .option('--timeout <seconds>', 'Login timeout in seconds', '300')
    .action(async (platform: string, opts: { port: string; timeout: string }) => {
      const SUPPORTED = ['linkedin', 'instagram', 'x', 'gemini'];
      if (!SUPPORTED.includes(platform)) {
        console.error(`Unknown platform: ${platform}. Supported: ${SUPPORTED.join(', ')}`);
        process.exit(1);
      }

      let adapter: ReturnType<typeof getAdapter>;
      try { adapter = getAdapter(platform); } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      const cdpPort = Number(opts.port);
      const timeoutMs = Number(opts.timeout) * 1000;

      // Lazy-load browser module
      let browser: typeof import('../browser/index.js');
      try { browser = await import('../browser/index.js'); } catch (err) {
        console.error('Browser module unavailable:', err);
        process.exit(1);
      }

      // Connect to Chrome (or launch if needed)
      let conn: Awaited<ReturnType<typeof browser.connectToTarget>>;
      try {
        conn = await browser.connectToTarget(cdpPort);
        console.log(`Connected to Chrome on port ${cdpPort}`);
      } catch {
        console.log(`Chrome not found on port ${cdpPort} — launching managed browser...`);
        try {
          const port = await browser.launchBrowser({ port: cdpPort, headless: false });
          conn = await browser.connectToTarget(port);
        } catch (err) {
          console.error('Failed to connect or launch Chrome:', err);
          process.exit(1);
        }
      }

      const { client, sessionId: sid } = conn;

      try {
        const refs = new Map();

        // Restore any existing cookies first so the user might already be logged in
        const sessions = await loadSessions();
        const existingSession = sessions.find(s => s.platform === platform);
        if (existingSession?.cookies) {
          try {
            const cookies = JSON.parse(existingSession.cookies);
            if (cookies.length > 0) await browser.setCookies(client, sid, cookies);
          } catch { /* ignore */ }
        }

        // Navigate to login URL
        console.log(`\nOpening ${platform} login page...`);
        await browser.openUrl(client, sid, adapter.loginURL());

        // Check if already logged in after cookie restore
        const pageIface = {
          evaluate: async <T>(expr: string) => browser.evaluateJs(client, sid, expr) as Promise<T>,
          url: async () => browser.getCurrentUrl(client, sid).catch(() => ''),
        };
        let isLoggedIn = await adapter.isLoggedIn(pageIface).catch(() => false);

        if (!isLoggedIn) {
          console.log('');
          console.log('┌──────────────────────────────────────────────────────┐');
          console.log(`│  Please sign in to ${platform.padEnd(34)}│`);
          console.log('│                                                      │');
          console.log('│  Complete the login in the browser window.           │');
          console.log(`│  Waiting up to ${Math.round(timeoutMs / 60000)} minutes for login…           │`);
          console.log('└──────────────────────────────────────────────────────┘');
          console.log('');

          const deadline = Date.now() + timeoutMs;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 2000));
            isLoggedIn = await adapter.isLoggedIn(pageIface).catch(() => false);
            if (isLoggedIn) break;
            // Navigate to app URL if user manually browsed away from login
            const currentUrl = await browser.getCurrentUrl(client, sid).catch(() => '');
            if (!currentUrl.includes(new URL(adapter.loginURL()).hostname) &&
                !currentUrl.includes(new URL(adapter.baseURL).hostname)) {
              await browser.openUrl(client, sid, adapter.loginURL());
            }
          }

          if (!isLoggedIn) {
            console.error(`\nLogin timeout after ${Math.round(timeoutMs / 1000)}s. Session not saved.`);
            process.exit(1);
          }
        }

        console.log('Login detected! Capturing session...');

        // Capture cookies and user agent
        const liveCookies = await browser.getCookies(client, sid).catch(() => []);
        const userAgent = await browser.evaluateJs(client, sid, 'navigator.userAgent').catch(() => 'unknown') as string;
        const username = await adapter.extractUsername(pageIface).catch(() => `${platform}-user`);

        // Save to sessions file
        const sessionEntry: Session = {
          id: `${platform}:${username}`,
          platform,
          username: username || `${platform}-user`,
          cookies: JSON.stringify(liveCookies),
          userAgent: String(userAgent),
          createdAt: existingSession?.createdAt ?? Date.now(),
          lastUsedAt: Date.now(),
        };
        const idx = sessions.findIndex(s => s.platform === platform);
        if (idx >= 0) sessions[idx] = sessionEntry; else sessions.push(sessionEntry);
        await saveSessions(sessions);

        console.log(`\n✓ Session saved: ${sessionEntry.id}`);
        console.log(`  Cookies: ${liveCookies.length} captured`);
        console.log(`  File: ${SESSIONS_FILE}`);
        console.log('');
        console.log(`Session will be automatically used by: monomind browse workflow run`);
      } finally {
        client.close();
      }
    });

  cmd
    .command('list')
    .description('List connected platform accounts')
    .action(async () => {
      const sessions = await loadSessions();
      if (sessions.length === 0) {
        console.log('No connected accounts. Run: browse platform connect <platform>');
        return;
      }
      console.log(`\n${'ID'.padEnd(40)} ${'PLATFORM'.padEnd(12)} ${'USERNAME'.padEnd(30)} LAST USED`);
      console.log('─'.repeat(95));
      for (const s of sessions) {
        const lastUsed = new Date(s.lastUsedAt).toLocaleString();
        console.log(`${s.id.padEnd(40)} ${s.platform.padEnd(12)} ${s.username.padEnd(30)} ${lastUsed}`);
      }
    });

  cmd
    .command('disconnect <id>')
    .description('Remove a saved platform session')
    .action(async (id: string) => {
      const sessions = await loadSessions();
      const idx = sessions.findIndex(s => s.id === id);
      if (idx < 0) {
        console.error(`Session not found: ${id}`);
        console.log('Run "browse platform list" to see available sessions.');
        process.exit(1);
      }
      sessions.splice(idx, 1);
      await saveSessions(sessions);
      console.log(`Disconnected: ${id}`);
    });

  return cmd;
}
