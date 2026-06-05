import type { CdpClient } from './cdp.js';
export interface RecordOptions {
    path?: string;
    format?: 'jpeg' | 'png' | 'webp';
    quality?: number;
    everyNthFrame?: number;
    maxWidth?: number;
    maxHeight?: number;
}
export interface RecordingState {
    frames: string[];
    offScreencast: (() => void) | null;
}
export declare function startRecording(client: CdpClient, sessionId: string, options?: RecordOptions): Promise<void>;
export declare function stopRecording(client: CdpClient, sessionId: string, outputPath?: string): Promise<string>;
export declare function getRecordingStatus(sessionId: string): {
    recording: boolean;
    frames: number;
};
export declare function saveFrameAsPng(client: CdpClient, sessionId: string, frameIndex: number, outputPath: string): Promise<void>;
//# sourceMappingURL=record.d.ts.map