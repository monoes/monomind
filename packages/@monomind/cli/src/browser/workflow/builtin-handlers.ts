// Built-in node handlers registered for every `browse workflow run` invocation.
//
// action.http         — fetch a URL (GET/POST/etc.) and put the response in item.data
// action.save_file    — write item data or binaryBase64 to a file on disk
// action.log          — console.log each item (useful for debugging workflows)
// action.gemini_image — generate image via Gemini web app (browser automation on port 9222)
//                       or Imagen REST API (GEMINI_API_KEY), or mock mode
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NodeHandler } from './engine.js';
import type { Item } from './types.js';

// Generate an image using the Gemini web app on the user's authenticated Chrome (CDP port).
// Uses the browser module directly (same process — no subprocess overhead, no shell escaping).
// Returns the saved file path on success, null if Chrome is not available on that port.
async function generateViaGeminiBrowser(
  prompt: string,
  outputPath: string,
  cdpPort: number,
): Promise<string | null> {
  // Lazy-load browser module so test environments without Chrome don't fail on import
  let browser: typeof import('../index.js');
  try {
    browser = await import('../index.js');
  } catch {
    return null;
  }

  // Connect to the user's running Chrome on cdpPort
  let conn: Awaited<ReturnType<typeof browser.connectToTarget>>;
  try {
    conn = await browser.connectToTarget(cdpPort);
  } catch {
    return null; // Chrome not running on this port
  }

  const { client, sessionId } = conn;
  const refs = new Map();

  try {
    // Navigate to Gemini
    await browser.openUrl(client, sessionId, 'https://gemini.google.com/app');

    // Dismiss cookie consent if present
    const cookieRef = await browser.findByRole(client, sessionId, refs, 'button', { name: 'Accept all' }).catch(() => null);
    if (cookieRef) {
      await browser.clickElement(client, sessionId, cookieRef);
      await new Promise(r => setTimeout(r, 1500));
    }

    // Find the Gemini prompt input (.ql-editor contenteditable)
    // Only present when user is logged in — if not found, fall through to REST/mock
    const inputRef = await browser.findBySelector(client, sessionId, refs, '.ql-editor');
    if (!inputRef) {
      console.log(`[action.gemini_image] .ql-editor not found on port ${cdpPort} — user may not be logged into Gemini`);
      return null;
    }

    // Fill the prompt (fillElement handles contenteditable, clear-all, and type)
    await browser.fillElement(client, sessionId, inputRef, prompt);
    await new Promise(r => setTimeout(r, 300));

    // Submit by pressing Enter
    await browser.pressKey(client, sessionId, 'Return');
    console.log(`[action.gemini_image] Prompt submitted to Gemini, waiting for image generation...`);

    // Poll up to 90s for a large generated image to appear in the DOM
    const imageCheckExpr = `
      (() => {
        const imgs = Array.from(document.querySelectorAll('img'));
        return imgs.some(img =>
          img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&
          img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&
          !img.src.includes('logo') && !img.src.includes('profile')
        );
      })()
    `;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const found = await browser.evaluateJs(client, sessionId, imageCheckExpr).catch(() => false);
      if (found) break;
      await new Promise(r => setTimeout(r, 500));
    }

    await mkdir(dirname(outputPath), { recursive: true });

    // Extract the generated image URL from the DOM
    const evalResult = await client.send<{ result: { value?: string } }>(
      'Runtime.evaluate',
      {
        expression: `
          (() => {
            const imgs = Array.from(document.querySelectorAll('img'));
            const c = imgs.filter(img =>
              img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&
              img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&
              !img.src.includes('logo') && !img.src.includes('profile')
            );
            return c.length ? c[c.length - 1].src : '';
          })()
        `,
        returnByValue: true,
      },
      sessionId,
    ).catch(() => null);

    const imgSrc = evalResult?.result?.value ?? '';

    if (imgSrc && (imgSrc.startsWith('https://') || imgSrc.startsWith('http://'))) {
      try {
        const resp = await fetch(imgSrc);
        if (resp.ok) {
          const buf = Buffer.from(await resp.arrayBuffer());
          await writeFile(outputPath, buf);
          console.log(`[action.gemini_image] Image downloaded from Gemini → ${outputPath}`);
          return outputPath;
        }
      } catch { /* fall through to screenshot */ }
    }

    // Fallback: full-page screenshot of the Gemini response
    const screenshotPath = outputPath.replace(/\.(png|jpe?g|webp)$/i, '') + '-screenshot.png';
    const ss = await browser.captureScreenshot(client, sessionId, { path: screenshotPath, fullPage: true }).catch(() => null);
    if (ss) {
      console.log(`[action.gemini_image] Saved Gemini screenshot → ${ss.path}`);
      return ss.path;
    }

    return null;
  } finally {
    client.close();
  }
}

export function createBuiltinHandlers(): Map<string, NodeHandler> {
  const handlers = new Map<string, NodeHandler>();

  // action.http
  // config: { url, method?, headers?, body?, responseField? }
  // Puts { statusCode, body, json? } into item.data[responseField ?? 'response']
  handlers.set('action.http', async (items, config) => {
    const url = String(config['url'] ?? '');
    const method = String(config['method'] ?? 'GET').toUpperCase();
    const headers = (config['headers'] as Record<string, string>) ?? {};
    const body = config['body'] !== undefined ? JSON.stringify(config['body']) : undefined;
    const responseField = String(config['responseField'] ?? 'response');

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
    });

    const text = await res.text();
    let json: unknown;
    try { json = JSON.parse(text); } catch { /* not JSON */ }

    return items.map(item => ({
      ...item,
      data: {
        ...item.data,
        [responseField]: { statusCode: res.status, body: text, json },
      },
    }));
  });

  // action.save_file
  // config: { path, content?, field?, encoding? }
  // Writes item.data[field] (or binaryBase64 decoded) to disk
  handlers.set('action.save_file', async (items, config) => {
    const results: Item[] = [];
    for (const item of items) {
      const outPath = String(config['path'] ?? './output.txt');
      const field = config['field'] as string | undefined;
      const encoding = String(config['encoding'] ?? 'utf8');

      await mkdir(dirname(outPath), { recursive: true });

      if (item.binaryBase64) {
        await writeFile(outPath, Buffer.from(item.binaryBase64, 'base64'));
      } else {
        const content = field
          ? JSON.stringify(item.data[field] ?? '', null, 2)
          : (config['content'] as string ?? JSON.stringify(item.data, null, 2));
        await writeFile(outPath, content, encoding as BufferEncoding);
      }

      results.push({ ...item, data: { ...item.data, savedPath: outPath } });
    }
    return results;
  });

  // action.log
  // config: { label? }
  handlers.set('action.log', async (items, config) => {
    const label = String(config['label'] ?? 'action.log');
    for (const item of items) {
      console.log(`[${label}]`, JSON.stringify(item.data, null, 2));
    }
    return items;
  });

  // action.gemini_image
  // config: { prompt, cdpPort?, outputPath?, apiKey?, model?, aspectRatio? }
  // Priority: (1) Gemini web browser via CDP port 9222, (2) Imagen REST API, (3) mock
  handlers.set('action.gemini_image', async (items, config) => {
    const cdpPort = Number(config['cdpPort'] ?? process.env['GEMINI_CDP_PORT'] ?? 9222);
    const apiKey = String(config['apiKey'] ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? '');
    const model = String(config['model'] ?? 'imagen-3.0-generate-001');
    const aspectRatio = String(config['aspectRatio'] ?? '1:1');
    const outputPath = config['outputPath'] as string | undefined;

    const results: Item[] = [];

    for (const item of items) {
      const prompt = String(config['prompt'] ?? item.data['prompt'] ?? '');
      const filePath = outputPath ?? `./output/gemini-image-${Date.now()}.png`;

      // Priority 1: Browser automation via authenticated Chrome session
      const browserPath = await generateViaGeminiBrowser(prompt, filePath, cdpPort);
      if (browserPath) {
        results.push({
          ...item,
          data: { ...item.data, prompt, generatedImagePath: browserPath, source: 'gemini-browser' },
        });
        continue;
      }

      // Priority 2: Gemini Imagen REST API
      if (apiKey) {
        console.log(`[action.gemini_image] Browser unavailable — trying Imagen REST API`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            instances: [{ prompt }],
            parameters: { sampleCount: 1, aspectRatio },
          }),
        });

        if (!res.ok) throw new Error(`Gemini Imagen API error ${res.status}: ${await res.text()}`);

        const data = await res.json() as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
        const prediction = data.predictions?.[0];
        if (!prediction?.bytesBase64Encoded) throw new Error('No image data in Gemini response');

        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, Buffer.from(prediction.bytesBase64Encoded, 'base64'));

        results.push({
          ...item,
          data: { ...item.data, prompt, generatedImagePath: filePath, mimeType: prediction.mimeType ?? 'image/png', source: 'gemini-api' },
          binaryBase64: prediction.bytesBase64Encoded,
        });
        continue;
      }

      // Priority 3: Mock mode — no browser on port 9222 and no API key
      console.log(`[action.gemini_image] No browser on port ${cdpPort} and no API key — mock mode.`);
      console.log(`  Prompt: "${prompt}"`);
      results.push({
        ...item,
        data: {
          ...item.data,
          prompt,
          mockMode: true,
          note: `Set GEMINI_CDP_PORT env var (default: 9222) for browser mode, or GEMINI_API_KEY for REST API`,
        },
      });
    }

    return results;
  });

  return handlers;
}
