import type { CdpClient } from './cdp.js';
export interface ProfilerOptions {
    path?: string;
    samplingInterval?: number;
}
export declare function startCpuProfile(client: CdpClient, sessionId: string, options?: ProfilerOptions): Promise<void>;
export declare function stopCpuProfile(client: CdpClient, sessionId: string, outputPath?: string): Promise<string>;
export declare function isProfilingActive(sessionId: string): boolean;
export declare function startHeapSnapshot(client: CdpClient, sessionId: string, outputPath?: string): Promise<string>;
//# sourceMappingURL=profiler.d.ts.map