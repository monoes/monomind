import type { CdpClient } from '@monoes/monobrowse';
export interface PageInterface {
    client: CdpClient;
    sessionId: string;
    evaluate<T>(fn: string): Promise<T>;
    url(): Promise<string>;
}
export interface PlatformAdapter {
    platform: string;
    baseURL: string;
    reservedPaths: string[];
    isLoggedIn(page: PageInterface): Promise<boolean>;
    loginURL(): string;
    extractUsername(page: PageInterface): Promise<string>;
}
export declare function registerAdapter(adapter: PlatformAdapter): void;
export declare function getAdapter(platform: string): PlatformAdapter;
export declare function listAdapters(): PlatformAdapter[];
//# sourceMappingURL=index.d.ts.map