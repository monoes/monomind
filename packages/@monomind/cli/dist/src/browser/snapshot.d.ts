import type { CdpClient } from './cdp.js';
import type { ElementRef, SnapshotOptions, SnapshotResult } from './types.js';
export declare function captureSnapshot(client: CdpClient, sessionId: string, options?: SnapshotOptions): Promise<SnapshotResult>;
export declare function resolveRef(client: CdpClient, sessionId: string, refs: Map<string, ElementRef>, refKey: string): Promise<ElementRef>;
export declare function getObjectIdForRef(client: CdpClient, sessionId: string, ref: ElementRef): Promise<string | null>;
export declare function getElementBox(client: CdpClient, sessionId: string, ref: ElementRef): Promise<{
    x: number;
    y: number;
    width: number;
    height: number;
} | null>;
//# sourceMappingURL=snapshot.d.ts.map