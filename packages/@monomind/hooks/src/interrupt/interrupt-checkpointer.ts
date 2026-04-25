import { randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AgentSpawnPayload {
  agentType: string;
  agentId: string;
  config?: Record<string, unknown>;
  priority: string;
  metadata?: Record<string, unknown>;
}

export interface InterruptCheckpoint {
  checkpointId: string;
  swarmId: string;
  step: number;
  pendingSpawn: AgentSpawnPayload;
  createdAt: number;
  resolvedAt?: number;
  status: 'pending' | 'approved' | 'rejected';
}

interface UpdateRecord {
  type: 'update';
  checkpointId: string;
  status: 'approved' | 'rejected';
  resolvedAt: number;
}

export class InterruptCheckpointer {
  constructor(private readonly filePath: string) {
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  save(swarmId: string, step: number, pendingSpawn: AgentSpawnPayload): string {
    const checkpointId = `chk-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
    const record: InterruptCheckpoint = {
      checkpointId,
      swarmId,
      step,
      pendingSpawn,
      createdAt: Date.now(),
      status: 'pending',
    };
    appendFileSync(this.filePath, JSON.stringify(record) + '\n');
    return checkpointId;
  }

  approve(checkpointId: string): void {
    this.updateStatus(checkpointId, 'approved');
  }

  reject(checkpointId: string): void {
    this.updateStatus(checkpointId, 'rejected');
  }

  get(checkpointId: string): InterruptCheckpoint | undefined {
    return this.readAll().find((r) => r.checkpointId === checkpointId);
  }

  listPending(): InterruptCheckpoint[] {
    return this.readAll().filter((r) => r.status === 'pending');
  }

  private updateStatus(checkpointId: string, status: 'approved' | 'rejected'): void {
    const update: UpdateRecord = {
      type: 'update',
      checkpointId,
      status,
      resolvedAt: Date.now(),
    };
    appendFileSync(this.filePath, JSON.stringify(update) + '\n');
  }

  private readAll(): InterruptCheckpoint[] {
    if (!existsSync(this.filePath)) return [];
    const lines = readFileSync(this.filePath, 'utf-8').split('\n').filter(Boolean);
    const checkpoints = new Map<string, InterruptCheckpoint>();
    for (const line of lines) {
      const record = JSON.parse(line);
      if (record.type === 'update') {
        const existing = checkpoints.get(record.checkpointId);
        if (existing) {
          existing.status = record.status;
          existing.resolvedAt = record.resolvedAt;
        }
      } else {
        checkpoints.set(record.checkpointId, record as InterruptCheckpoint);
      }
    }
    return Array.from(checkpoints.values());
  }
}
