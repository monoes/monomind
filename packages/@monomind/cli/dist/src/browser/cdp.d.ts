import type { CdpTarget } from './types.js';
export declare class CdpClient {
    private ws;
    private pendingCommands;
    private eventListeners;
    private nextId;
    private connected;
    connect(wsUrl: string): Promise<void>;
    send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<T>;
    on(event: string, fn: (params: Record<string, unknown>, sessionId?: string) => void): () => void;
    once(event: string, sessionId?: string): Promise<Record<string, unknown>>;
    onceWithOff(event: string, sessionId?: string): [Promise<Record<string, unknown>>, () => void];
    close(): void;
    isConnected(): boolean;
}
export declare function fetchTargets(port: number): Promise<CdpTarget[]>;
export declare function fetchNewTarget(port: number, url: string): Promise<CdpTarget>;
//# sourceMappingURL=cdp.d.ts.map