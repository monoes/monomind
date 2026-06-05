import type { CdpClient } from './cdp.js';
interface HarRequest {
    id: string;
    url: string;
    method: string;
    status: number;
    statusText: string;
    mimeType: string;
    requestHeaders: Record<string, string>;
    responseHeaders: Record<string, string>;
    startTime: number;
    endTime: number;
    size: number;
    encodedSize: number;
    fromCache: boolean;
    responseBody?: string;
    bodyEncoding?: 'base64';
}
export declare function startHarRecording(client: CdpClient, sessionId: string): Promise<void>;
export declare function stopHarRecording(client: CdpClient, sessionId: string, outputPath?: string, captureResponseBodies?: boolean): Promise<string>;
export declare function getHarStatus(sessionId: string): {
    recording: boolean;
    requestCount: number;
};
export declare function getRequests(sessionId: string): Partial<HarRequest>[];
export {};
//# sourceMappingURL=har.d.ts.map