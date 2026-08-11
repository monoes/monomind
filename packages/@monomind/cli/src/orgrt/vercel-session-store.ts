// packages/@monomind/cli/src/orgrt/vercel-session-store.ts
/**
 * VercelSessionStore — persists Vercel conversation history for resume.
 *
 * The Vercel AI SDK is stateless: streamText/generateText don't persist
 * conversation history server-side (unlike Claude Agent SDK's session ID).
 * To support checkpoint/resume, we serialize the message array to disk and
 * reload it on the next run when a session ID is provided.
 *
 * Session IDs are role-scoped and stable: a new UUID is minted per role per
 * org (not per result), persisted in the filename, and reused across restarts
 * via the `resume` argument. This matches the AgentRunner contract where
 * session.ts carries `resumeSessionId` across maxTurns restarts and
 * checkpoint-ops.ts persists it to `runtime.json`.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';

/** Cap to prevent unbounded growth; oldest non-system messages dropped. */
const MAX_MESSAGES = 200;

export interface VercelMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export class VercelSessionStore {
  readonly sessionId: string;
  private readonly filePath: string;

  constructor(orgDir: string, roleId: string, sessionId?: string) {
    this.sessionId = sessionId ?? `${roleId}-${crypto.randomUUID()}`;
    const sessionsDir = path.join(orgDir, 'sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    this.filePath = path.join(sessionsDir, `${this.sessionId}.json`);
  }

  async load(): Promise<VercelMessage[]> {
    try {
      const data = await fs.promises.readFile(this.filePath, 'utf8');
      return JSON.parse(data) as VercelMessage[];
    } catch {
      return [];
    }
  }

  async save(messages: VercelMessage[]): Promise<void> {
    const trimmed = messages.length > MAX_MESSAGES
      ? [
          ...messages.filter(m => m.role === 'system'),
          ...messages.filter(m => m.role !== 'system').slice(-(MAX_MESSAGES - 1)),
        ]
      : messages;
    await fs.promises.writeFile(this.filePath, JSON.stringify(trimmed, null, 2));
  }
}
