/**
 * NestedSwarmEnvelope — Task 44
 *
 * Encapsulates a sub-swarm conversation, hiding raw transcripts
 * from the parent swarm and exposing only a summary result.
 */

import { randomBytes } from 'crypto';
import type {
  SubSwarmStatus,
  Message,
  SwarmSummary,
  NestedSwarmResult,
} from './types.js';

export class NestedSwarmEnvelope {
  public readonly subSwarmId: string;
  public readonly parentSwarmId: string;
  public readonly createdAt: Date;

  private status: SubSwarmStatus = 'initializing';
  private messages: Message[] = [];
  private summary: SwarmSummary | null = null;
  private error?: string;
  private completedAt?: Date;

  constructor(parentSwarmId: string, _task: string) {
    this.parentSwarmId = parentSwarmId;
    this.subSwarmId = `sub-${randomBytes(8).toString('hex')}`;
    this.createdAt = new Date();
  }

  /** Add a message to the raw transcript. */
  addMessage(message: Message): void {
    if (this.status === 'completed' || this.status === 'failed' || this.status === 'timed_out') {
      throw new Error(`Cannot add messages to envelope in '${this.status}' status`);
    }
    if (this.status === 'initializing') {
      this.status = 'running';
    }
    this.messages.push(message);
  }

  /** Attach a generated summary. */
  setSummary(summary: SwarmSummary): void {
    this.summary = summary;
  }

  /** Mark the sub-swarm as completed. */
  complete(): void {
    this.status = 'completed';
    this.completedAt = new Date();
  }

  /** Mark the sub-swarm as failed with an error. */
  fail(error: string): void {
    this.status = 'failed';
    this.error = error;
    this.completedAt = new Date();
  }

  /** Mark the sub-swarm as timed out. */
  timeout(): void {
    this.status = 'timed_out';
    this.completedAt = new Date();
  }

  /** Return the result for the parent — does NOT include raw messages. */
  toResult(): NestedSwarmResult {
    return {
      subSwarmId: this.subSwarmId,
      parentSwarmId: this.parentSwarmId,
      status: this.status,
      summary: this.summary,
      error: this.error,
      createdAt: this.createdAt,
      completedAt: this.completedAt,
    };
  }

  /** Return a copy of the raw transcript (for internal use only). */
  getRawMessages(): Message[] {
    return [...this.messages];
  }

  /** Return the number of messages in the transcript. */
  getMessageCount(): number {
    return this.messages.length;
  }

  /** Return the current status. */
  getStatus(): SubSwarmStatus {
    return this.status;
  }
}
