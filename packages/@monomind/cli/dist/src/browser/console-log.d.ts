import type { CdpClient } from './cdp.js';
export interface ConsoleMessage {
    type: 'log' | 'error' | 'warn' | 'info' | 'debug' | 'verbose';
    text: string;
    timestamp: number;
    url?: string;
    lineNumber?: number;
}
export interface PageError {
    text: string;
    url?: string;
    lineNumber?: number;
    columnNumber?: number;
    timestamp: number;
}
export declare function setupConsoleCapture(client: CdpClient, sessionId: string): void;
export declare function enableConsoleCapture(client: CdpClient, sessionId: string): Promise<void>;
export declare function getConsoleMessages(sessionId?: string): ConsoleMessage[];
export declare function clearConsoleMessages(sessionId?: string): void;
export declare function getPageErrors(sessionId?: string): PageError[];
export declare function clearPageErrors(sessionId?: string): void;
export declare function teardownConsoleCapture(sessionId: string): void;
//# sourceMappingURL=console-log.d.ts.map