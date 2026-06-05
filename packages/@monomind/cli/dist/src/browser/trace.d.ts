import type { CdpClient } from './cdp.js';
export interface TraceOptions {
    path?: string;
    categories?: string[];
    screenshots?: boolean;
}
export declare function startTrace(client: CdpClient, sessionId: string, options?: TraceOptions): Promise<void>;
export declare function stopTrace(client: CdpClient, sessionId: string, outputPath?: string): Promise<string>;
export declare function getTraceStatus(sessionId: string): boolean;
//# sourceMappingURL=trace.d.ts.map