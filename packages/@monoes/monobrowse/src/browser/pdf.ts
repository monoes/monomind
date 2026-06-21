import type { CdpClient } from './cdp.js';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

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

export async function capturePdf(
  client: CdpClient,
  sessionId: string,
  options: PdfOptions = {}
): Promise<string> {
  const params: Record<string, unknown> = {
    landscape: options.landscape ?? false,
    printBackground: options.printBackground ?? true,
    scale: options.scale ?? 1,
  };

  if (options.paperWidth) params.paperWidth = options.paperWidth;
  if (options.paperHeight) params.paperHeight = options.paperHeight;
  if (options.marginTop !== undefined) params.marginTop = options.marginTop;
  if (options.marginBottom !== undefined) params.marginBottom = options.marginBottom;
  if (options.marginLeft !== undefined) params.marginLeft = options.marginLeft;
  if (options.marginRight !== undefined) params.marginRight = options.marginRight;

  const result = await client.send<{ data: string }>('Page.printToPDF', params, sessionId);
  const outputPath = options.path ?? join(tmpdir(), `monomind-pdf-${Date.now()}.pdf`);
  await writeFile(outputPath, Buffer.from(result.data, 'base64'));
  return outputPath;
}
