import type { SessionState } from './types.js';
import type { CdpClient } from './cdp.js';
export declare function saveSession(client: CdpClient, sessionId: string, targetId: string, name: string, url: string, title: string): Promise<string>;
export declare function loadSession(client: CdpClient, sessionId: string, name: string): Promise<SessionState>;
export declare function saveStateFile(client: CdpClient, sessionId: string, targetId: string, filePath: string, url: string, title: string): Promise<void>;
export declare function loadStateFile(client: CdpClient, sessionId: string, filePath: string): Promise<SessionState>;
export declare function listSessions(): Promise<string[]>;
//# sourceMappingURL=session.d.ts.map