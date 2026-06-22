// createBrowserHandlers — CDP-backed NodeHandler implementations for @monoes/monoplaybook.
//
// browser.open        — connect to Chrome CDP and open a URL
// browser.navigate    — navigate the current tab to a URL
// browser.click       — click an element (selector | role | text | label | placeholder)
// browser.type        — type text into an element (keystroke-by-keystroke)
// browser.fill        — set an input value directly (faster than type)
// browser.select      — pick an <option> by value or visible text
// browser.check       — check or uncheck a checkbox / radio
// browser.hover       — hover over an element
// browser.press       — press a key or combo (e.g. "Enter", "Ctrl+A")
// browser.scroll      — scroll up/down/left/right by pixel amount
// browser.wait        — wait for selector | url | load | networkidle | duration
// browser.extract     — pull text, attribute, html, all_text, url, or title into item.data
// browser.snapshot    — capture an accessibility tree snapshot
// browser.screenshot  — take a screenshot (saves to file or returns base64)
// browser.evaluate    — run arbitrary JS; result goes into item.data
// browser.close       — drop the cached CDP connection (does not kill Chrome)

import type { NodeHandler, Item } from '@monoes/monoplaybook';
import { CdpClient } from '../cdp.js';
import {
  connectToTarget,
  openUrl,
  waitForLoad,
  getCurrentUrl,
  getCurrentTitle,
} from '../browser.js';
import {
  clickElement,
  fillElement,
  typeText,
  pressKey,
  scrollElement,
  hoverElement,
  selectOption,
  checkElement,
  evaluateJs,
} from '../actions.js';
import {
  findBySelector,
  findByRole,
  findByText,
  findByLabel,
  findByPlaceholder,
} from '../find.js';
import { waitFor } from '../wait.js';
import { captureSnapshot } from '../snapshot.js';
import { captureScreenshot } from '../screenshot.js';
import type { ElementRef } from '../types.js';
import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Shared connection state — cached per CDP port across nodes in one playbook run
// ---------------------------------------------------------------------------

interface BrowserConnection {
  client: CdpClient;
  sessionId: string;
  refs: Map<string, ElementRef>;
}

const connectionCache = new Map<number, BrowserConnection>();

async function getConnection(port: number): Promise<BrowserConnection> {
  if (connectionCache.has(port)) return connectionCache.get(port)!;
  const { client, sessionId } = await connectToTarget(port);
  const conn: BrowserConnection = { client, sessionId, refs: new Map() };
  connectionCache.set(port, conn);
  return conn;
}

function releaseConnection(port: number): void {
  connectionCache.delete(port);
}

function safeResolvePath(rawPath: string): string {
  const cwd = process.cwd();
  const abs = resolve(cwd, rawPath);
  if (abs !== cwd && !abs.startsWith(cwd + '/')) {
    throw new Error(`Path traversal blocked: "${rawPath}" resolves outside working directory`);
  }
  return abs;
}

// ---------------------------------------------------------------------------
// Element resolution — locator types: selector | role | text | label | placeholder
// ---------------------------------------------------------------------------

async function findElement(
  conn: BrowserConnection,
  config: Record<string, unknown>,
): Promise<ElementRef> {
  const locator = (config['locator'] as string | undefined) ?? 'selector';
  const value = config['value'] as string;
  if (!value) throw new Error(`browser handler requires config.value (the element locator)`);

  const { client, sessionId, refs } = conn;
  const opts = {
    exact: config['exact'] as boolean | undefined,
    nth: config['nth'] as number | undefined,
  };

  let ref: ElementRef | null = null;
  switch (locator) {
    case 'selector':    ref = await findBySelector(client, sessionId, refs, value); break;
    case 'role':        ref = await findByRole(client, sessionId, refs, value, opts); break;
    case 'text':        ref = await findByText(client, sessionId, refs, value, opts); break;
    case 'label':       ref = await findByLabel(client, sessionId, refs, value, opts); break;
    case 'placeholder': ref = await findByPlaceholder(client, sessionId, refs, value, opts); break;
    default: throw new Error(`Unknown locator "${locator}". Use: selector|role|text|label|placeholder`);
  }

  if (!ref) throw new Error(`Element not found: ${locator}="${value}"`);
  return ref;
}

// Modifier bitmask used by CDP (matches DevTools protocol)
function modifierBits(modifiers: string[]): number {
  let bits = 0;
  for (const m of modifiers) {
    switch (m.toLowerCase()) {
      case 'alt':   bits |= 1; break;
      case 'ctrl':
      case 'control': bits |= 2; break;
      case 'meta':
      case 'cmd':   bits |= 4; break;
      case 'shift': bits |= 8; break;
    }
  }
  return bits;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export function createBrowserHandlers(): Map<string, NodeHandler> {
  const h = new Map<string, NodeHandler>();

  // ── browser.open ──────────────────────────────────────────────────────────
  h.set('browser.open', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const url = config['url'] as string;
    if (!url) throw new Error('browser.open requires config.url');
    const timeout = (config['timeoutMs'] as number | undefined) ?? 30000;
    const condition = (config['waitUntil'] as 'load' | 'networkidle' | 'domcontentloaded' | undefined) ?? 'load';

    const conn = await getConnection(port);
    await openUrl(conn.client, conn.sessionId, url);
    await waitForLoad(conn.client, conn.sessionId, condition, timeout);

    const currentUrl = await getCurrentUrl(conn.client, conn.sessionId);
    const title = await getCurrentTitle(conn.client, conn.sessionId);
    return items.map(item => ({ ...item, data: { ...item.data, url: currentUrl, title, port } }));
  });

  // ── browser.navigate ──────────────────────────────────────────────────────
  h.set('browser.navigate', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const url = config['url'] as string;
    if (!url) throw new Error('browser.navigate requires config.url');
    const timeout = (config['timeoutMs'] as number | undefined) ?? 30000;
    const condition = (config['waitUntil'] as 'load' | 'networkidle' | 'domcontentloaded' | undefined) ?? 'load';

    const conn = await getConnection(port);
    await openUrl(conn.client, conn.sessionId, url);
    await waitForLoad(conn.client, conn.sessionId, condition, timeout);

    const currentUrl = await getCurrentUrl(conn.client, conn.sessionId);
    const title = await getCurrentTitle(conn.client, conn.sessionId);
    return items.map(item => ({ ...item, data: { ...item.data, url: currentUrl, title } }));
  });

  // ── browser.click ─────────────────────────────────────────────────────────
  h.set('browser.click', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    await clickElement(conn.client, conn.sessionId, ref);
    return items;
  });

  // ── browser.type ──────────────────────────────────────────────────────────
  h.set('browser.type', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const text = config['text'] as string;
    if (text === undefined) throw new Error('browser.type requires config.text');

    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    if (config['clear'] !== false) {
      await fillElement(conn.client, conn.sessionId, ref, '');
    }
    await typeText(conn.client, conn.sessionId, text);
    return items;
  });

  // ── browser.fill ──────────────────────────────────────────────────────────
  h.set('browser.fill', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const text = (config['text'] as string | undefined) ?? '';

    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    await fillElement(conn.client, conn.sessionId, ref, text);
    return items;
  });

  // ── browser.select ────────────────────────────────────────────────────────
  h.set('browser.select', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const option = config['option'] as string;
    if (!option) throw new Error('browser.select requires config.option');

    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    await selectOption(conn.client, conn.sessionId, ref, option);
    return items;
  });

  // ── browser.check ─────────────────────────────────────────────────────────
  h.set('browser.check', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const checked = (config['checked'] as boolean | undefined) ?? true;

    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    await checkElement(conn.client, conn.sessionId, ref, checked);
    return items;
  });

  // ── browser.hover ─────────────────────────────────────────────────────────
  h.set('browser.hover', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const conn = await getConnection(port);
    const ref = await findElement(conn, config);
    await hoverElement(conn.client, conn.sessionId, ref);
    return items;
  });

  // ── browser.press ─────────────────────────────────────────────────────────
  // Config: port, key — e.g. "Enter", "Tab", "Escape", "Ctrl+A", "Shift+Tab"
  h.set('browser.press', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const key = config['key'] as string;
    if (!key) throw new Error('browser.press requires config.key');

    const conn = await getConnection(port);
    if (key.includes('+')) {
      const parts = key.split('+').map(k => k.trim());
      const mainKey = parts[parts.length - 1];
      const bits = modifierBits(parts.slice(0, -1));
      // Use low-level CDP for key combos (pressKeyCombo API takes key + modifierBits)
      const { default: _unused, ...keyData } = { default: null };
      void _unused;
      await conn.client.send('Input.dispatchKeyEvent', {
        type: 'rawKeyDown',
        key: mainKey,
        code: `Key${mainKey.toUpperCase()}`,
        modifiers: bits,
      }, conn.sessionId);
      await conn.client.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        key: mainKey,
        code: `Key${mainKey.toUpperCase()}`,
        modifiers: bits,
      }, conn.sessionId);
    } else {
      await pressKey(conn.client, conn.sessionId, key);
    }
    return items;
  });

  // ── browser.scroll ────────────────────────────────────────────────────────
  // Config: port, direction (up|down|left|right, default "down"), amount (px, default 300),
  //         locator + value (optional — scroll a specific element)
  h.set('browser.scroll', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const direction = (config['direction'] as 'up' | 'down' | 'left' | 'right' | undefined) ?? 'down';
    const amount = (config['amount'] as number | undefined) ?? 300;

    const conn = await getConnection(port);
    const hasLocator = !!(config['value']);

    if (hasLocator) {
      const ref = await findElement(conn, config);
      await scrollElement(conn.client, conn.sessionId, direction, amount, ref);
    } else {
      await scrollElement(conn.client, conn.sessionId, direction, amount);
    }
    return items;
  });

  // ── browser.wait ──────────────────────────────────────────────────────────
  // Config: port, for (selector|url|load|networkidle|duration), value, timeoutMs
  h.set('browser.wait', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const conn = await getConnection(port);
    const waitKind = (config['for'] as string | undefined) ?? 'duration';
    const timeout = (config['timeoutMs'] as number | undefined) ?? 30000;
    const value = config['value'];

    switch (waitKind) {
      case 'duration':
        await new Promise(res => setTimeout(res, (value as number | undefined) ?? 1000));
        break;
      case 'selector':
        await waitFor(conn.client, conn.sessionId, { selector: value as string, timeout });
        break;
      case 'url':
        await waitFor(conn.client, conn.sessionId, { url: value as string, timeout });
        break;
      case 'load':
        await waitForLoad(conn.client, conn.sessionId, 'load', timeout);
        break;
      case 'networkidle':
        await waitForLoad(conn.client, conn.sessionId, 'networkidle', timeout);
        break;
      default:
        throw new Error(`browser.wait: unknown 'for' value: "${waitKind}". Use selector|url|load|networkidle|duration`);
    }
    return items;
  });

  // ── browser.extract ───────────────────────────────────────────────────────
  // Config: port, as (text|attribute|html|all_text|url|title), locator, value,
  //         attribute (when as=attribute), outputKey (default "extracted")
  h.set('browser.extract', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const as = (config['as'] as string | undefined) ?? 'text';
    const outputKey = (config['outputKey'] as string | undefined) ?? 'extracted';
    const conn = await getConnection(port);

    if (as === 'url') {
      const url = await getCurrentUrl(conn.client, conn.sessionId);
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: url } }));
    }
    if (as === 'title') {
      const title = await getCurrentTitle(conn.client, conn.sessionId);
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: title } }));
    }
    if (as === 'all_text') {
      const text = await evaluateJs(conn.client, conn.sessionId, 'document.body.innerText');
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: text } }));
    }

    const ref = await findElement(conn, config);

    if (as === 'text') {
      const result = await conn.client.send<{ result: { value: unknown } }>(
        'Runtime.callFunctionOn',
        { objectId: ref.objectId, functionDeclaration: 'function(){return this.innerText ?? this.textContent ?? ""}', returnByValue: true },
        conn.sessionId,
      );
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: result.result.value } }));
    }

    if (as === 'attribute') {
      const attr = config['attribute'] as string;
      if (!attr) throw new Error('browser.extract with as=attribute requires config.attribute');
      const result = await conn.client.send<{ result: { value: unknown } }>(
        'Runtime.callFunctionOn',
        {
          objectId: ref.objectId,
          functionDeclaration: `function(){return this.getAttribute(${JSON.stringify(attr)})}`,
          returnByValue: true,
        },
        conn.sessionId,
      );
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: result.result.value } }));
    }

    if (as === 'html') {
      const result = await conn.client.send<{ result: { value: unknown } }>(
        'Runtime.callFunctionOn',
        { objectId: ref.objectId, functionDeclaration: 'function(){return this.outerHTML}', returnByValue: true },
        conn.sessionId,
      );
      return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: result.result.value } }));
    }

    throw new Error(`browser.extract: unknown 'as' value: "${as}". Use text|attribute|html|all_text|url|title`);
  });

  // ── browser.snapshot ──────────────────────────────────────────────────────
  // Captures an accessibility tree. Output stored in item.data[outputKey].
  // Config: port, selector (scope to element), interactiveOnly, compact, outputKey
  h.set('browser.snapshot', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const outputKey = (config['outputKey'] as string | undefined) ?? 'snapshot';
    const conn = await getConnection(port);

    const result = await captureSnapshot(conn.client, conn.sessionId, {
      selector: config['selector'] as string | undefined,
      interactiveOnly: (config['interactiveOnly'] as boolean | undefined) ?? false,
      compact: (config['compact'] as boolean | undefined) ?? true,
    });
    return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: result } }));
  });

  // ── browser.screenshot ────────────────────────────────────────────────────
  // Config: port, path (optional file path), fullPage, format (jpeg|png|webp),
  //         quality, outputKey (default "screenshot")
  // Output: if path is set → saves file and puts path in data; else → puts dataUrl in data + binaryBase64
  h.set('browser.screenshot', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const outputKey = (config['outputKey'] as string | undefined) ?? 'screenshot';
    const conn = await getConnection(port);

    const userPath = config['path'] as string | undefined;
    const absPath = userPath ? safeResolvePath(userPath) : undefined;
    if (absPath) await mkdir(dirname(absPath), { recursive: true });

    const { path: savedPath, dataUrl } = await captureScreenshot(conn.client, conn.sessionId, {
      path: absPath,
      fullPage: (config['fullPage'] as boolean | undefined) ?? false,
      format: (config['format'] as 'jpeg' | 'png' | 'webp' | undefined) ?? 'png',
      quality: config['quality'] as number | undefined,
    });

    return items.map(item => ({
      ...item,
      data: { ...item.data, [outputKey]: userPath ? savedPath : dataUrl },
    }));
  });

  // ── browser.evaluate ──────────────────────────────────────────────────────
  // Config: port, script (JS expression), outputKey (default "result")
  h.set('browser.evaluate', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    const script = config['script'] as string;
    if (!script) throw new Error('browser.evaluate requires config.script');
    const outputKey = (config['outputKey'] as string | undefined) ?? 'result';

    const conn = await getConnection(port);
    const result = await evaluateJs(conn.client, conn.sessionId, script);
    return items.map(item => ({ ...item, data: { ...item.data, [outputKey]: result } }));
  });

  // ── browser.close ─────────────────────────────────────────────────────────
  h.set('browser.close', async (items, config): Promise<Item[]> => {
    const port = (config['port'] as number | undefined) ?? 9222;
    releaseConnection(port);
    return items;
  });

  return h;
}
