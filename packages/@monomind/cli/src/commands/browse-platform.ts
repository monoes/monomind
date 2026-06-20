/**
 * Browse Platform Command — Manage platform connections (LinkedIn, Instagram, X, Gemini)
 * Sessions stored as JSON at ~/.monomind/sessions.json
 */

import { Command } from 'commander';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { getAdapter } from '../browser/adapters/index.js';

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
}

export function createPlatformCommand(): Command {
  const cmd = new Command('platform').description('Manage platform connections');

  cmd
    .command('connect <platform>')
    .description('Connect a platform account (opens browser for login)')
    .action(async (platform: string) => {
      const SUPPORTED = ['linkedin', 'instagram', 'x', 'gemini'];
      if (!SUPPORTED.includes(platform)) {
        console.error(`Unknown platform: ${platform}. Supported: ${SUPPORTED.join(', ')}`);
        process.exit(1);
      }

      let adapter: ReturnType<typeof getAdapter>;
      try {
        adapter = getAdapter(platform);
      } catch (err) {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
      }

      console.log(`Opening browser for ${platform} login...`);
      console.log(`Login URL: ${adapter.loginURL()}`);
      console.log('');
      console.log('Browser CDP integration required for automatic login detection.');
      console.log('For v1, please log in manually and then run:');
      console.log(`  monomind browse platform connect ${platform}  (after logging in)`);
      console.log('');
      console.log('Full browser automation for platform connect is available when Chrome is running');
      console.log('with --remote-debugging-port=9222 and the browser page-factory is configured.');

      // For v1, save a placeholder session so the user can test the flow
      const sessions = await loadSessions();
      const username = `${platform}-user@example.com`;
      const sessionId = `${platform}:${username}`;
      const existing = sessions.findIndex(s => s.id === sessionId);
      const session: Session = {
        id: sessionId,
        platform,
        username,
        cookies: '[]',
        userAgent: 'Mozilla/5.0',
        createdAt: existing >= 0 ? sessions[existing].createdAt : Date.now(),
        lastUsedAt: Date.now(),
      };
      if (existing >= 0) {
        sessions[existing] = session;
      } else {
        sessions.push(session);
      }
      await saveSessions(sessions);
      console.log(`\nSession saved: ${sessionId}`);
      console.log('Note: Automatic login detection requires browser integration (Task 12).');
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
