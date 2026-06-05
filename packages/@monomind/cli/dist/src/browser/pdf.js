import { writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
export async function capturePdf(client, sessionId, options = {}) {
    const params = {
        landscape: options.landscape ?? false,
        printBackground: options.printBackground ?? true,
        scale: options.scale ?? 1,
    };
    if (options.paperWidth)
        params.paperWidth = options.paperWidth;
    if (options.paperHeight)
        params.paperHeight = options.paperHeight;
    if (options.marginTop !== undefined)
        params.marginTop = options.marginTop;
    if (options.marginBottom !== undefined)
        params.marginBottom = options.marginBottom;
    if (options.marginLeft !== undefined)
        params.marginLeft = options.marginLeft;
    if (options.marginRight !== undefined)
        params.marginRight = options.marginRight;
    const result = await client.send('Page.printToPDF', params, sessionId);
    const outputPath = options.path ?? join(tmpdir(), `monomind-pdf-${Date.now()}.pdf`);
    await writeFile(outputPath, Buffer.from(result.data, 'base64'));
    return outputPath;
}
//# sourceMappingURL=pdf.js.map