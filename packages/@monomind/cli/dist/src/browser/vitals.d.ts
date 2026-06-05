import type { CdpClient } from './cdp.js';
export interface WebVitals {
    lcp?: number;
    fcp?: number;
    cls?: number;
    ttfb?: number;
    inp?: number;
    domInteractive?: number;
    domContentLoaded?: number;
    loadTime?: number;
    resources?: number;
}
export declare function collectVitals(client: CdpClient, sessionId: string, waitMs?: number): Promise<WebVitals>;
export declare function formatVitals(vitals: WebVitals): string;
//# sourceMappingURL=vitals.d.ts.map