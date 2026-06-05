import type { CdpClient } from './cdp.js';
export interface PdfOptions {
    path?: string;
    landscape?: boolean;
    paperWidth?: number;
    paperHeight?: number;
    marginTop?: number;
    marginBottom?: number;
    marginLeft?: number;
    marginRight?: number;
    printBackground?: boolean;
    scale?: number;
}
export declare function capturePdf(client: CdpClient, sessionId: string, options?: PdfOptions): Promise<string>;
//# sourceMappingURL=pdf.d.ts.map