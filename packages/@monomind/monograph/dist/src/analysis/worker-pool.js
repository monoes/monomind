import { Worker } from 'node:worker_threads';
import { cpus } from 'node:os';
const DEFAULT_STACK_SIZE_MB = 16;
let _globalPool = null;
export class WorkerPool {
    threads;
    stackSizeMb;
    constructor(opts = {}) {
        this.threads = opts.threads ?? cpus().length;
        this.stackSizeMb = opts.stackSizeMb ?? DEFAULT_STACK_SIZE_MB;
    }
    run(workerScript, input) {
        return new Promise((resolve, reject) => {
            const worker = new Worker(workerScript, {
                workerData: input,
                resourceLimits: { stackSizeMb: this.stackSizeMb },
            });
            worker.on('message', (v) => resolve(v));
            worker.on('error', reject);
            worker.on('exit', code => {
                if (code !== 0)
                    reject(new Error(`Worker exited with code ${code}`));
            });
        });
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