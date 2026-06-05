import type { CdpClient } from './cdp.js';
export interface ScreenshotOptions {
    path?: string;
    fullPage?: boolean;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
    annotate?: boolean;
}
export declare function captureScreenshot(client: CdpClient, sessionId: string, options?: ScreenshotOptions): Promise<{
    path: string;
    dataUrl: string;
}>;
export declare function setViewport(client: CdpClient, sessionId: string, width: number, height: number): Promise<void>;
export declare function setUserAgent(client: CdpClient, sessionId: string, userAgent: string): Promise<void>;
//# sourceMappingURL=screenshot.d.ts.map