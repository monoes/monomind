import type { CdpClient } from './cdp.js';
export interface DialogInfo {
    type: 'alert' | 'confirm' | 'prompt' | 'beforeunload';
    message: string;
    defaultPrompt?: string;
}
export declare function setupDialogAutoHandling(client: CdpClient, sessionId: string, autoAccept?: boolean): void;
export declare function teardownDialogHandling(sessionId: string): void;
export declare function acceptDialog(client: CdpClient, sessionId: string, text?: string): Promise<void>;
export declare function dismissDialog(client: CdpClient, sessionId: string): Promise<void>;
export declare function getDialogStatus(sessionId: string): DialogInfo | null;
//# sourceMappingURL=dialog.d.ts.map