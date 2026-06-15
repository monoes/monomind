import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';

const DEFAULT_STACK_SIZE_MB = 16;

export interface WorkerPoolOptions {
  threads?: number;
  stackSizeMb?: number;
}

interface QueuedTask {
  script: string;
  input: unknown;
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let _globalPool: WorkerPool | null = null;

export class WorkerPool {
  readonly threads: number;
  readonly stackSizeMb: number;

  private _active = 0;
  private readonly _queue: QueuedTask[] = [];

  constructor(opts: WorkerPoolOptions = {}) {
    this.threads = opts.threads ?? cpus().length;
    this.stackSizeMb = opts.stackSizeMb ?? DEFAULT_STACK_SIZE_MB;
  }

  run<T>(workerScript: string, input: unknown): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this._queue.push({ script: workerScript, input, resolve: resolve as (v: unknown) => void, reject });
      this._drain();
    });
  }

  private _drain(): void {
    while (this._active < this.threads && this._queue.length > 0) {
      const task = this._queue.shift()!;
      this._active++;
      const worker = new Worker(task.script, {
        workerData: task.input,
        resourceLimits: { stackSizeMb: this.stackSizeMb },
      });
      const cleanup = () => {
        this._active--;
        this._drain();
      };
      worker.on('message', (v: unknown) => {
        task.resolve(v);
        cleanup();
      });
      worker.on('error', (err: unknown) => {
        task.reject(err);
        cleanup();
      });
      worker.on('exit', (code: number) => {
        if (code !== 0) {
          task.reject(new Error(`Worker exited with code ${code}`));
          cleanup();
        }
      });
    }
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
