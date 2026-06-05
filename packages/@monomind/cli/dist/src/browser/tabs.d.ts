import type { CdpClient } from './cdp.js';
import type { CdpTarget } from './types.js';
export declare function listTabs(port: number): Promise<CdpTarget[]>;
export declare function newTab(port: number, url?: string): Promise<CdpTarget>;
export declare function closeTab(client: CdpClient, _sessionId: string, targetId: string): Promise<void>;
export declare function activateTab(client: CdpClient, oldSessionId: string, targetId: string): Promise<string>;
export declare function switchToFrame(_client: CdpClient, _sessionId: string, _frameSelector: string): Promise<string | null>;
//# sourceMappingURL=tabs.d.ts.map