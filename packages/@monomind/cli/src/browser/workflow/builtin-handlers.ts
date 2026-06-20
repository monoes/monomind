// Built-in node handlers registered for every `browse workflow run` invocation.
//
// action.http    — fetch a URL (GET/POST/etc.) and put the response in item.data
// action.save_file — write item data or binaryBase64 to a file on disk
// action.log     — console.log each item (useful for debugging workflows)
// action.gemini_image — call the Gemini Imagen REST API to generate an image
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { NodeHandler } from './engine.js';
import type { Item } from './types.js';

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
  // config: { prompt, apiKey?, model?, outputPath?, aspectRatio? }
  // Uses Gemini Imagen API. Falls back to a prompt-only mock if no API key.
  handlers.set('action.gemini_image', async (items, config) => {
    const apiKey = String(config['apiKey'] ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY'] ?? '');
    const model = String(config['model'] ?? 'imagen-3.0-generate-001');
    const aspectRatio = String(config['aspectRatio'] ?? '1:1');
    const outputPath = config['outputPath'] as string | undefined;

    const results: Item[] = [];

    for (const item of items) {
      const prompt = String(config['prompt'] ?? item.data['prompt'] ?? '');

      if (!apiKey) {
        // No API key — return the prompt as a mock result so the workflow still completes
        console.log(`[action.gemini_image] No API key — mock mode. Prompt: "${prompt}"`);
        results.push({
          ...item,
          data: {
            ...item.data,
            prompt,
            mockMode: true,
            note: 'Set GEMINI_API_KEY or pass apiKey param to generate real images',
          },
        });
        continue;
      }

      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: { sampleCount: 1, aspectRatio },
        }),
      });

      if (!res.ok) {
        throw new Error(`Gemini Imagen API error ${res.status}: ${await res.text()}`);
      }

      const data = await res.json() as { predictions?: { bytesBase64Encoded?: string; mimeType?: string }[] };
      const prediction = data.predictions?.[0];
      if (!prediction?.bytesBase64Encoded) {
        throw new Error('No image data in Gemini response');
      }

      const filePath = outputPath ?? `./output/growing-up-${Date.now()}.png`;
      await mkdir(dirname(filePath), { recursive: true });
      await writeFile(filePath, Buffer.from(prediction.bytesBase64Encoded, 'base64'));

      results.push({
        ...item,
        data: { ...item.data, prompt, generatedImagePath: filePath, mimeType: prediction.mimeType ?? 'image/png' },
        binaryBase64: prediction.bytesBase64Encoded,
      });
    }

    return results;
  });

  return handlers;
}
