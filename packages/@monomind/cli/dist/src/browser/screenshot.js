import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
export async function captureScreenshot(client, sessionId, options = {}) {
    const format = options.format ?? 'png';
    const params = { format };
    if (format === 'jpeg' || format === 'webp') {
        params.quality = options.quality ?? 80;
    }
    if (options.fullPage) {
        const dims = await client.send('Runtime.evaluate', {
            expression: 'JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
            returnByValue: true,
        }, sessionId);
        const { w, h } = JSON.parse(dims.result?.value ?? '{"w":1280,"h":720}');
        params.clip = { x: 0, y: 0, width: w, height: h, scale: 1 };
        params.captureBeyondViewport = true;
    }
    const result = await client.send('Page.captureScreenshot', params, sessionId);
    const data = result.data;
    const dataUrl = `data:image/${format};base64,${data}`;
    const outputPath = options.path ?? join(tmpdir(), `monomind-screenshot-${Date.now()}.${format}`);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(data, 'base64'));
    return { path: outputPath, dataUrl };
}
export async function setViewport(client, sessionId, width, height) {
    await client.send('Emulation.setDeviceMetricsOverride', {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
    }, sessionId);
}
export async function setUserAgent(client, sessionId, userAgent) {
    await client.send('Emulation.setUserAgentOverride', { userAgent }, sessionId);
}
//# sourceMappingURL=screenshot.js.map