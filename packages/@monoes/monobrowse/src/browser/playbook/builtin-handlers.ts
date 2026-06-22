// Built-in node handlers registered for every `browse workflow run` invocation.
//
// action.http         — fetch a URL (GET/POST/etc.) and put the response in item.data
// action.save_file    — write item data or binaryBase64 to a file on disk
// action.log          — console.log each item (useful for debugging workflows)
// action.gemini_image — generate image via Gemini web app (browser automation + session store)
//                       or Imagen REST API (GEMINI_API_KEY), or mock mode
import { writeFile, readFile, mkdir, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

/** Resolve a user-supplied path and assert it stays within the working directory. */
function safeResolvePath(rawPath: string): string {
  const cwd = process.cwd();
  const safePath = resolve(cwd, rawPath);
  if (safePath !== cwd && !safePath.startsWith(cwd + '/')) {
    throw new Error(`Path traversal blocked: "${rawPath}" resolves outside working directory`);
  }
  return safePath;
}
import type { NodeHandler } from './engine.js';
import type { Item } from './types.js';

// ---------------------------------------------------------------------------
// Session persistence (shared format with browse-platform.ts)
// ---------------------------------------------------------------------------

const SESSIONS_FILE = join(homedir(), '.monomind', 'sessions.json');

interface StoredSession {
  id: string;
  platform: string;
  username: string;
  cookies: string;   // JSON-serialized CDP cookie array
  userAgent: string;
  createdAt: number;
  lastUsedAt: number;
}

async function loadStoredSession(platform: string): Promise<StoredSession | null> {
  if (!existsSync(SESSIONS_FILE)) return null;
  try {
    const sessions: StoredSession[] = JSON.parse(await readFile(SESSIONS_FILE, 'utf-8'));
    return sessions.find(s => s.platform === platform) ?? null;
  } catch { return null; }
}

async function saveStoredSession(
  platform: string,
  cookies: object[],
  userAgent: string,
  username: string,
): Promise<void> {
  let sessions: StoredSession[] = [];
  if (existsSync(SESSIONS_FILE)) {
    try { sessions = JSON.parse(await readFile(SESSIONS_FILE, 'utf-8')); } catch { /* start fresh */ }
  }
  const id = `${platform}:${username}`;
  const now = Date.now();
  const existing = sessions.findIndex(s => s.platform === platform);
  const entry: StoredSession = {
    id, platform, username, userAgent,
    cookies: JSON.stringify(cookies),
    createdAt: existing >= 0 ? sessions[existing].createdAt : now,
    lastUsedAt: now,
  };
  if (existing >= 0) sessions[existing] = entry; else sessions.push(entry);
  await mkdir(join(homedir(), '.monomind'), { recursive: true });
  await writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
  await chmod(SESSIONS_FILE, 0o600);
}

// ---------------------------------------------------------------------------
// Gemini browser automation
// ---------------------------------------------------------------------------

const GEMINI_IMAGE_CHECK = `
  (() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    return imgs.some(img =>
      img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&
      img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&
      !img.src.includes('logo') && !img.src.includes('profile')
    );
  })()
`;

const GEMINI_IMAGE_SRC = `
  (() => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const c = imgs.filter(img =>
      img.complete && img.naturalWidth > 200 && img.naturalHeight > 200 &&
      img.src && !img.src.includes('icon') && !img.src.includes('avatar') &&
      !img.src.includes('logo') && !img.src.includes('profile')
    );
    return c.length ? c[c.length - 1].src : '';
  })()
`;

// Generate an image via the Gemini web app, with session management.
// Flow: connect → restore saved session → if not logged in, wait for user login → generate.
// Returns the saved file path, or null if Chrome is not available.
async function generateViaGeminiBrowser(
  prompt: string,
  outputPath: string,
  cdpPort: number,
): Promise<string | null> {
  let browser: typeof import('../index.js');
  try { browser = await import('../index.js'); } catch { return null; }

  let conn: Awaited<ReturnType<typeof browser.connectToTarget>>;
  try { conn = await browser.connectToTarget(cdpPort); } catch { return null; }

  const { client, sessionId } = conn;
  const refs = new Map();

  try {
    // Restore stored Gemini session cookies before navigating
    const stored = await loadStoredSession('gemini');
    if (stored?.cookies) {
      try {
        const cookies = JSON.parse(stored.cookies) as object[];
        if (cookies.length > 0) {
          await browser.setCookies(client, sessionId, cookies as Parameters<typeof browser.setCookies>[2]);
        }
      } catch { /* ignore malformed cookies */ }
    }

    // Navigate to Gemini
    await browser.openUrl(client, sessionId, 'https://gemini.google.com/app');

    // Dismiss cookie consent if present
    const refs2 = new Map();
    const consentBtn = await browser.findByRole(client, sessionId, refs2, 'button', { name: 'Accept all' }).catch(() => null);
    if (consentBtn) {
      await browser.clickElement(client, sessionId, consentBtn);
      await new Promise(r => setTimeout(r, 1500));
    }

    // Check if logged in — .ql-editor only appears when authenticated
    let inputRef = await browser.findBySelector(client, sessionId, refs, '.ql-editor').catch(() => null);

    if (!inputRef) {
      // Not logged in — ask the user to authenticate
      console.log('');
      console.log('┌─────────────────────────────────────────────────────────┐');
      console.log('│  Gemini login required                                  │');
      console.log('│                                                         │');
      console.log('│  A browser window has been opened to Gemini.            │');
      console.log('│  Please sign in with your Google account.               │');
      console.log('│                                                         │');
      console.log('│  The workflow will resume automatically after login.    │');
      console.log('│  Waiting up to 5 minutes…                               │');
      console.log('└─────────────────────────────────────────────────────────┘');
      console.log('');

      // Navigate to Google sign-in
      await browser.openUrl(client, sessionId, 'https://accounts.google.com/signin/v2/identifier');

      // Wait up to 5 min for the user to complete login and land back on Gemini
      const loginDeadline = Date.now() + 5 * 60 * 1000;
      let loggedIn = false;
      while (Date.now() < loginDeadline) {
        await new Promise(r => setTimeout(r, 2000));
        const url = await browser.getCurrentUrl(client, sessionId).catch(() => '');
        if (url.includes('gemini.google.com')) {
          inputRef = await browser.findBySelector(client, sessionId, refs, '.ql-editor').catch(() => null);
          if (inputRef) { loggedIn = true; break; }
        }
      }

      if (!loggedIn) {
        console.log('[action.gemini_image] Login timeout. Run: monomind browse platform connect gemini');
        return null;
      }

      console.log('[action.gemini_image] Login detected! Saving session...');
    }

    // Save/refresh cookies after confirming login
    const liveCookies = await browser.getCookies(client, sessionId).catch(() => []);
    const userAgent = await browser.evaluateJs(client, sessionId, 'navigator.userAgent').catch(() => 'unknown') as string;
    const username = await browser.evaluateJs(
      client, sessionId,
      "document.querySelector('.gb_A.gb_Sa')?.textContent?.trim() ?? 'gemini-user'"
    ).catch(() => 'gemini-user') as string;
    await saveStoredSession('gemini', liveCookies, String(userAgent), String(username));

    // Ensure we're on the app page with the input visible
    if (!inputRef) {
      await browser.openUrl(client, sessionId, 'https://gemini.google.com/app');
      inputRef = await browser.findBySelector(client, sessionId, refs, '.ql-editor').catch(() => null);
    }
    if (!inputRef) return null;

    // Fill and submit the prompt
    await browser.fillElement(client, sessionId, inputRef, prompt);
    await new Promise(r => setTimeout(r, 300));
    await browser.pressKey(client, sessionId, 'Return');
    console.log('[action.gemini_image] Prompt submitted to Gemini, waiting for image...');

    // Poll up to 90s for generated image
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const found = await browser.evaluateJs(client, sessionId, GEMINI_IMAGE_CHECK).catch(() => false);
      if (found) break;
      await new Promise(r => setTimeout(r, 500));
    }

    await mkdir(dirname(outputPath), { recursive: true });

    // Extract image URL and download
    const imgSrc = (await browser.evaluateJs(client, sessionId, GEMINI_IMAGE_SRC).catch(() => '')) as string;
    if (imgSrc && (imgSrc.startsWith('https://') || imgSrc.startsWith('http://'))) {
      try {
        const resp = await fetch(imgSrc);
        if (resp.ok) {
          await writeFile(outputPath, Buffer.from(await resp.arrayBuffer()));
          console.log(`[action.gemini_image] Image saved → ${outputPath}`);
          return outputPath;
        }
      } catch { /* fall through to screenshot */ }
    }

    // Fallback: screenshot the response
    const screenshotPath = outputPath.replace(/\.(png|jpe?g|webp)$/i, '') + '-screenshot.png';
    const ss = await browser.captureScreenshot(client, sessionId, { path: screenshotPath, fullPage: true }).catch(() => null);
    if (ss) { console.log(`[action.gemini_image] Screenshot saved → ${ss.path}`); return ss.path; }

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
      const outPath = safeResolvePath(String(config['path'] ?? './output.txt'));
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
      const filePath = safeResolvePath(outputPath ?? `./output/gemini-image-${Date.now()}.png`);

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
