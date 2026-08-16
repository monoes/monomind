/**
 * `monomind events` — headless JSONL tail of the dashboard's live event
 * stream (/api/mastermind-stream), so scripts can pipe it into jq or a log
 * file without opening a browser. Uses the same control.json/dashboard-token
 * auth pattern `org mark-complete` already uses (org.ts).
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';

export const eventsCommand: Command = {
  name: 'events',
  description: 'Stream live org events from the dashboard as JSONL (headless, for piping into other tools)',
  examples: [
    { command: 'monomind events', description: 'Stream events from the running dashboard to stdout as JSONL' },
    { command: 'monomind events | jq .type', description: 'Pipe events into jq for filtering' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const cwd = resolve(ctx.cwd || process.cwd());

    let ctrlUrl = 'http://localhost:4242';
    try {
      const ctl = JSON.parse(readFileSync(join(cwd, '.monomind', 'control.json'), 'utf8')) as { url?: string };
      if (ctl.url) ctrlUrl = ctl.url;
    } catch {
      /* default */
    }

    let auth = '';
    try {
      auth = readFileSync(join(cwd, '.monomind', 'dashboard-token'), 'utf8').trim();
    } catch {
      /* server may be pre-auth */
    }

    const streamUrl = `${ctrlUrl}/api/mastermind-stream?project=${encodeURIComponent(cwd)}`;
    const controller = new AbortController();

    let res: Response;
    try {
      res = await fetch(streamUrl, {
        headers: auth ? { 'x-monomind-token': auth } : {},
        signal: controller.signal,
      });
    } catch (err) {
      output.printError(
        `Dashboard unreachable at ${ctrlUrl} — is "monomind ui" running?`,
        err instanceof Error ? err.message : String(err),
      );
      return { success: false, exitCode: 1 };
    }

    if (!res.ok || !res.body) {
      output.printError(`Dashboard rejected the events stream (HTTP ${res.status})`);
      return { success: false, exitCode: 1 };
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    const onSigint = () => controller.abort();
    process.once('SIGINT', onSigint);

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let sepIndex: number;
        while ((sepIndex = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, sepIndex);
          buffer = buffer.slice(sepIndex + 2);
          for (const line of frame.split('\n')) {
            if (line.startsWith('data:')) {
              const payload = line.slice(5).trim();
              if (payload) process.stdout.write(payload + '\n');
            }
          }
        }
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        output.printError('Events stream ended unexpectedly', err instanceof Error ? err.message : String(err));
        return { success: false, exitCode: 1 };
      }
    } finally {
      process.removeListener('SIGINT', onSigint);
    }

    return { success: true };
  },
};
