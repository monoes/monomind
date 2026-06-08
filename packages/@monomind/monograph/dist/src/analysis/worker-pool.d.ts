export interface WorkerPoolOptions {
    threads?: number;
    stackSizeMb?: number;
}
export declare class WorkerPool {
    readonly threads: number;
    readonly stackSizeMb: number;
    constructor(opts?: WorkerPoolOptions);
    run<T>(workerScript: string, input: unknown): Promise<T>;
}
export declare function configureGlobalPool(threads?: number, stackSizeMb?: number): WorkerPool;
export declare function getGlobalPool(): WorkerPool;
export declare function resetGlobalPool(): void;
//# sourceMappingURL=worker-pool.d.ts.map