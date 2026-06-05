import type { CdpClient } from './cdp.js';
export declare function getLocalStorageKey(client: CdpClient, sessionId: string, key: string): Promise<string | null>;
export declare function setLocalStorageKey(client: CdpClient, sessionId: string, key: string, value: string): Promise<void>;
export declare function removeLocalStorageKey(client: CdpClient, sessionId: string, key: string): Promise<void>;
export declare function clearLocalStorage(client: CdpClient, sessionId: string): Promise<void>;
export declare function getAllLocalStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>>;
export declare function getSessionStorageKey(client: CdpClient, sessionId: string, key: string): Promise<string | null>;
export declare function setSessionStorageKey(client: CdpClient, sessionId: string, key: string, value: string): Promise<void>;
export declare function removeSessionStorageKey(client: CdpClient, sessionId: string, key: string): Promise<void>;
export declare function clearSessionStorage(client: CdpClient, sessionId: string): Promise<void>;
export declare function getAllSessionStorage(client: CdpClient, sessionId: string): Promise<Record<string, string>>;
//# sourceMappingURL=storage.d.ts.map