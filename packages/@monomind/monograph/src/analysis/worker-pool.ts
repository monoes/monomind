import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

const DEFAULT_STACK_SIZE_MB = 16;

export interface WorkerPoolOptions {
  threads?: number;
  stackSizeMb?: number;
}

let _globalPool: WorkerPool | null = null;

export class WorkerPool {
  readonly threads: number;
  readonly stackSizeMb: number;

  constructor(opts: WorkerPoolOptions = {}) {
    this.threads = opts.threads ?? cpus().length;
    this.stackSizeMb = opts.stackSizeMb ?? DEFAULT_STACK_SIZE_MB;
  }

  run<T>(workerScript: string, input: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      const worker = new Worker(workerScript, {
        workerData: input,
        resourceLimits: { stackSizeMb: this.stackSizeMb },
      });
      worker.on('message', (v: T) => resolve(v));
      worker.on('error', reject);
      worker.on('exit', code => {
        if (code !== 0) reject(new Error(`Worker exited with code ${code}`));
      });
    });
  }
}

export function configureGlobalPool(threads?: number, stackSizeMb?: number): WorkerPool {
  if (!_globalPool) _globalPool = new WorkerPool({ threads, stackSizeMb });
  return _globalPool;
}

export function getGlobalPool(): WorkerPool {
  return _globalPool ?? configureGlobalPool();
}

export function resetGlobalPool(): void {
  _globalPool = null;
}
