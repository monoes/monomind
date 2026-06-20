import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
const DEFAULT_STACK_SIZE_MB = 16;
let _globalPool = null;
export class WorkerPool {
    threads;
    stackSizeMb;
    _active = 0;
    _queue = [];
    constructor(opts = {}) {
        this.threads = opts.threads ?? cpus().length;
        this.stackSizeMb = opts.stackSizeMb ?? DEFAULT_STACK_SIZE_MB;
    }
    run(workerScript, input) {
        return new Promise((resolve, reject) => {
            this._queue.push({ script: workerScript, input, resolve: resolve, reject });
            this._drain();
        });
    }
    _drain() {
        while (this._active < this.threads && this._queue.length > 0) {
            const task = this._queue.shift();
            this._active++;
            const worker = new Worker(task.script, {
                workerData: task.input,
                resourceLimits: { stackSizeMb: this.stackSizeMb },
            });
            const cleanup = () => {
                this._active--;
                this._drain();
            };
            worker.on('message', (v) => {
                task.resolve(v);
                cleanup();
            });
            worker.on('error', (err) => {
                task.reject(err);
                cleanup();
            });
            worker.on('exit', (code) => {
                if (code !== 0) {
                    task.reject(new Error(`Worker exited with code ${code}`));
                    cleanup();
                }
            });
        }
    }
}
export function configureGlobalPool(threads, stackSizeMb) {
    if (!_globalPool)
        _globalPool = new WorkerPool({ threads, stackSizeMb });
    return _globalPool;
}
export function getGlobalPool() {
    return _globalPool ?? configureGlobalPool();
}
export function resetGlobalPool() {
    _globalPool = null;
}
//# sourceMappingURL=worker-pool.js.map