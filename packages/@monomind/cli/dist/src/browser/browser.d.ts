import { CdpClient } from './cdp.js';
import type { BrowserConfig, CdpTarget } from './types.js';
export declare function isPortOpen(port: number): Promise<boolean>;
export declare function launchBrowser(config?: BrowserConfig): Promise<number>;
export declare function enableSessionDomains(client: CdpClient, sessionId: string): Promise<void>;
export declare function connectToTarget(port: number, targetId?: string): Promise<{
    client: CdpClient;
    target: CdpTarget;
    sessionId: string;
}>;
export declare function openUrl(client: CdpClient, sessionId: string, url: string): Promise<void>;
export declare function waitForLoad(client: CdpClient, sessionId: string, condition?: 'load' | 'networkidle' | 'domcontentloaded', timeout?: number): Promise<void>;
export declare function getCurrentUrl(client: CdpClient, sessionId: string): Promise<string>;
export declare function getCurrentTitle(client: CdpClient, sessionId: string): Promise<string>;
//# sourceMappingURL=browser.d.ts.map