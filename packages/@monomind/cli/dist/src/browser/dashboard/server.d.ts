import type { StepEvent } from '../workflow/types.js';
interface DashboardServer {
    broadcast(event: StepEvent): void;
    close(): void;
    port: number;
}
export declare function getDashboardServer(port?: number): DashboardServer;
export {};
//# sourceMappingURL=server.d.ts.map