/**
 * JSONL-based input request store.
 * @packageDocumentation
 */

import { readFileSync, appendFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InputRequest } from './types.js';

export class InputRequestStore {
  private readonly filePath: string;

  constructor(dir: string) {
    this.filePath = join(dir, 'input-requests.jsonl');
    if (!existsSync(this.filePath)) {
      writeFileSync(this.filePath, '', 'utf-8');
    }
  }

  /**
   * Create a new input request and persist it.
   */
  create(
    agentId: string,
    taskId: string,
    agentOutput: string,
    confidenceScore: number,
    timeoutMs: number,
  ): InputRequest {
    const now = new Date();
    const request: InputRequest = {
      requestId: randomUUID(),
      agentId,
      taskId,
      agentOutput,
      confidenceScore,
      question: `Agent reported confidence ${confidenceScore}. Please review the output and provide guidance.`,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + timeoutMs).toISOString(),
      status: 'pending',
    };
    appendFileSync(this.filePath, JSON.stringify(request) + '\n', 'utf-8');
    return request;
  }

  /**
   * Mark a request as responded with the given response text.
   */
  respond(requestId: string, response: string): InputRequest | null {
    const all = this.readAll();
    const idx = all.findIndex((r) => r.requestId === requestId);
    if (idx === -1) return null;

    all[idx].status = 'responded';
    all[idx].response = response;
    all[idx].respondedAt = new Date().toISOString();

    this.writeAll(all);
    return all[idx];
  }

  /**
   * Poll for a request by ID.
   */
  poll(requestId: string): InputRequest | null {
    const all = this.readAll();
    return all.find((r) => r.requestId === requestId) ?? null;
  }

  // --- internal ---

  private readAll(): InputRequest[] {
    if (!existsSync(this.filePath)) return [];
    const content = readFileSync(this.filePath, 'utf-8').trim();
    if (!content) return [];
    return content.split('\n').map((line) => JSON.parse(line) as InputRequest);
  }

  private writeAll(records: InputRequest[]): void {
    const content = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
    writeFileSync(this.filePath, content, 'utf-8');
  }
}
