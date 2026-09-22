/**
 * Moving around and configuring the viewport — history navigation, scrolling,
 * SPA pushState, device/viewport/user-agent settings, and waiting for the page
 * to reach a condition.
 */

import type { ElementRef } from '../index.js';
import { output } from './output.js';
import { ensureConnected, getBrowser, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const waitCommand: Command = {
  name: 'wait',
  description: 'Wait for a condition to be met before proceeding',
  options: [
    { name: 'url', type: 'string', description: 'Wait for URL matching glob pattern' },
    { name: 'text', type: 'string', description: 'Wait for text to appear in page' },
    { name: 'not-text', type: 'string', description: 'Wait for text to disappear from page' },
    { name: 'selector', type: 'string', description: 'Wait for CSS selector to appear' },
    {
      name: 'load',
      type: 'string',
      description: 'Wait for load event: load|networkidle|domcontentloaded',
    },
    { name: 'fn', type: 'string', description: 'Wait until JS expression returns truthy' },
    { name: 'ms', type: 'number', description: 'Wait N milliseconds' },
    { name: 'timeout', short: 't', type: 'number', description: 'Timeout in ms', default: 30000 },
    {
      name: 'download',
      type: 'string',
      description:
        'Wait for a file download to complete and save to path (monitors Browser.downloadProgress events)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    if (ctx.flags.ms) {
      const rawMs = ctx.flags.ms as number;
      const waitMs = Number.isFinite(rawMs) ? Math.max(0, Math.min(rawMs, 60_000)) : 0; // cap at 60s
      await new Promise((r) => setTimeout(r, waitMs));
      output.printSuccess(`Waited ${ctx.flags.ms}ms`);
      return { success: true };
    }

    if (ctx.flags.fn) {
      const expr = ctx.flags.fn as string;
      const rawTimeout = (ctx.flags.timeout as number) ?? 30000;
      const timeout = Number.isFinite(rawTimeout)
        ? Math.max(100, Math.min(rawTimeout, 300_000))
        : 30000; // cap at 5min
      const interval = 200;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const result = await browser.evaluateJs(client, sessionId, expr);
        if (result) {
          output.printSuccess('Wait function returned truthy');
          return { success: true };
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      throw new Error(`Timeout waiting for --fn: ${expr}`);
    }

    if (ctx.flags['not-text']) {
      const target = ctx.flags['not-text'] as string;
      const timeout = (ctx.flags.timeout as number) ?? 30000;
      const interval = 200;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const text = (await browser.evaluateJs(
          client,
          sessionId,
          'document.body?.innerText ?? ""',
        )) as string;
        if (!text.includes(target)) {
          output.printSuccess('Text disappeared');
          return { success: true };
        }
        await new Promise((r) => setTimeout(r, interval));
      }
      throw new Error(`Timeout waiting for text to disappear: "${target}"`);
    }

    if (ctx.flags.download) {
      const savePath = ctx.flags.download as string;
      const { mkdir } = await import('node:fs/promises');
      const { dirname, join } = await import('node:path');
      const { tmpdir } = await import('node:os');
      const downloadDir = join(tmpdir(), `mm-dl-wait-${Date.now()}`);
      await mkdir(downloadDir, { recursive: true });
      await client
        .send(
          'Browser.setDownloadBehavior',
          {
            behavior: 'allow',
            downloadPath: downloadDir,
            eventsEnabled: true,
          },
          undefined,
        )
        .catch(() =>
          client
            .send(
              'Page.setDownloadBehavior',
              { behavior: 'allow', downloadPath: downloadDir },
              sessionId,
            )
            .catch(() => {}),
        );
      const MAX_DOWNLOAD_TIMEOUT = 5 * 60 * 1000; // I6: cap at 5 minutes
      const rawTimeout = Math.min((ctx.flags.timeout as number) ?? 30000, MAX_DOWNLOAD_TIMEOUT);
      const finalPath = await new Promise<string>((resolve, reject) => {
        let guid = '';
        let settled = false;
        // C2: capture off() functions to avoid listener leaks
        const offBegin = client.on(
          'Browser.downloadWillBegin',
          (params: Record<string, unknown>) => {
            guid = params.guid as string;
          },
        );
        let offProgress: (() => void) | undefined;
        // cleanup defined before setTimeout so the timeout callback can call it
        let tid: ReturnType<typeof setTimeout>;
        let pollTid: ReturnType<typeof setInterval> | undefined;
        const cleanup = () => {
          clearTimeout(tid);
          clearInterval(pollTid);
          offBegin?.();
          offProgress?.();
        };
        const finish = (path: string) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(path);
        };
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err);
        };
        tid = setTimeout(() => fail(new Error('Download timed out')), rawTimeout);
        offProgress = client.on(
          'Browser.downloadProgress',
          async (params: Record<string, unknown>) => {
            if (params.guid === guid && params.state === 'completed') {
              const { readdir, rename, rmdir } = await import('node:fs/promises');
              const files = await readdir(downloadDir);
              if (files.length > 0) {
                const src = join(downloadDir, files[0]);
                await mkdir(dirname(savePath), { recursive: true });
                await rename(src, savePath);
                await rmdir(downloadDir).catch(() => {}); // I1: cleanup temp dir
                finish(savePath);
              } else {
                await rmdir(downloadDir).catch(() => {}); // I1: cleanup temp dir
                fail(new Error('Download completed but no file found'));
              }
            } else if (params.guid === guid && params.state === 'canceled') {
              fail(new Error('Download was canceled'));
            }
          },
        );

        // Fallback for the empty-guid race: this process's listener attaches
        // AFTER a separate `click` process may have already started (and even
        // finished) the download — so downloadWillBegin/downloadProgress for it
        // were never observed here. While guid is still empty, poll the expected
        // output path directly: if it already exists with a stable, non-zero
        // size across two consecutive checks, treat the download as complete.
        let lastSize = -1;
        let stableReads = 0;
        pollTid = setInterval(async () => {
          if (settled || guid) return; // a real CDP event has taken over
          try {
            const { stat } = await import('node:fs/promises');
            const st = await stat(savePath);
            if (st.isFile() && st.size > 0 && st.size === lastSize) {
              stableReads++;
              if (stableReads >= 2) finish(savePath);
            } else {
              stableReads = 0;
            }
            lastSize = st.size;
          } catch {
            // savePath not present yet — keep polling until timeout
          }
        }, 300);
      });
      output.printSuccess(`Download saved: ${finalPath}`);
      return { success: true, data: { path: finalPath } };
    }

    await browser.waitFor(client, sessionId, {
      url: ctx.flags.url as string,
      text: ctx.flags.text as string,
      selector: ctx.flags.selector as string,
      load: ctx.flags.load as 'load' | 'networkidle' | 'domcontentloaded',
      timeout: ctx.flags.timeout as number,
    });

    output.printSuccess('Wait condition met');
    return { success: true };
  },
};

export const scrollCommand: Command = {
  name: 'scroll',
  description:
    'Scroll the page. Usage: monomind browse scroll up|down|left|right [amount] [--selector ".sidebar"]',
  options: [
    { name: 'amount', short: 'a', type: 'number', description: 'Pixels to scroll', default: 300 },
    { name: 'ref', type: 'string', description: 'Element ref to scroll within' },
    {
      name: 'selector',
      short: 's',
      type: 'string',
      description: 'CSS selector of element to scroll within',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const direction = ctx.args[0] as 'up' | 'down' | 'left' | 'right';
    if (!direction) throw new Error('Usage: monomind browse scroll up|down|left|right [amount]');

    // Support positional amount: scroll down 300
    const positionalAmount =
      ctx.args[1] !== undefined ? parseInt(ctx.args[1] as string, 10) : undefined;
    const amount =
      positionalAmount && Number.isFinite(positionalAmount)
        ? positionalAmount
        : ((ctx.flags.amount as number) ?? 300);

    if (ctx.flags.selector) {
      const sel = ctx.flags.selector as string;
      const dx = direction === 'right' ? amount : direction === 'left' ? -amount : 0;
      const dy = direction === 'down' ? amount : direction === 'up' ? -amount : 0;
      const posJson = (await browser.evaluateJs(
        client,
        sessionId,
        `(function(){var el=document.querySelector(${JSON.stringify(sel)});if(!el)return null;var r=el.getBoundingClientRect();return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2});})()`,
      )) as string | null;
      if (!posJson) throw new Error(`Selector not found: ${sel}`);
      const pos = JSON.parse(posJson) as { x: number; y: number };
      await client.send(
        'Input.dispatchMouseEvent',
        { type: 'mouseWheel', x: pos.x, y: pos.y, deltaX: dx, deltaY: dy },
        sessionId,
      );
      output.printSuccess(`Scrolled ${direction} in ${sel}`);
      return { success: true };
    }

    let ref: ElementRef | undefined;
    if (ctx.flags.ref) {
      const refKey = (ctx.flags.ref as string).startsWith('@')
        ? (ctx.flags.ref as string).slice(1)
        : (ctx.flags.ref as string);
      ref = session.refs.get(refKey);
    }

    await browser.scrollElement(client, sessionId, direction, amount, ref);
    output.printSuccess(`Scrolled ${direction}`);
    return { success: true };
  },
};

export const navigateCommand: Command = {
  name: 'navigate',
  description: 'Navigate browser history. Usage: monomind browse navigate back|forward|reload',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const direction = ctx.args[0] as string;
    if (!direction) throw new Error('Usage: monomind browse navigate back|forward|reload');

    if (direction === 'back' || direction === 'forward') {
      // Pre-register frame-start listener BEFORE JS navigation to avoid the race
      // where history.back/forward() returns before the browser issues any requests
      let offFrameStarted: () => void = () => {};
      const frameStartedPromise = new Promise<void>((resolve) => {
        offFrameStarted = client.on('Page.frameStartedLoading', (_params, sid) => {
          if (sid === sessionId) {
            const off = offFrameStarted;
            offFrameStarted = () => {};
            off();
            resolve();
          }
        });
      });
      try {
        await client.send(
          'Runtime.evaluate',
          {
            expression: direction === 'back' ? 'history.back()' : 'history.forward()',
          },
          sessionId,
        );
        let fallbackHandle: ReturnType<typeof setTimeout> | undefined;
        const fallbackPromise = new Promise<void>((r) => {
          fallbackHandle = setTimeout(r, 2000);
        });
        await Promise.race([frameStartedPromise, fallbackPromise]);
        if (fallbackHandle !== undefined) clearTimeout(fallbackHandle);
      } finally {
        offFrameStarted();
      }
      await browser.waitForLoad(client, sessionId, 'networkidle');
    } else if (direction === 'reload') {
      await client.send('Page.reload', {}, sessionId);
      await browser.waitForLoad(client, sessionId, 'load');
    } else {
      throw new Error(`Unknown direction: ${direction}. Use: back|forward|reload`);
    }

    // Refs captured before this navigation may now point at different content.
    session.refs = new Map();
    await browser.clearRefCache(session.port);

    output.printSuccess(`Navigated: ${direction}`);
    return { success: true };
  },
};

export const setCommand: Command = {
  name: 'set',
  description:
    'Configure browser settings. Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const setting = ctx.args[0] as string;
    if (!setting)
      throw new Error(
        'Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>',
      );

    switch (setting) {
      case 'viewport': {
        const width = parseInt(ctx.args[1] as string, 10);
        const height = parseInt(ctx.args[2] as string, 10);
        const dpr = parseFloat(ctx.args[3] as string) || undefined;
        if (Number.isNaN(width) || Number.isNaN(height))
          throw new Error('Usage: set viewport <width> <height> [dpr]');
        await client.send(
          'Emulation.setDeviceMetricsOverride',
          {
            width,
            height,
            deviceScaleFactor: dpr ?? 1,
            mobile: false,
          },
          sessionId,
        );
        output.printSuccess(`Viewport set to ${width}x${height}${dpr ? ` @${dpr}x` : ''}`);
        break;
      }
      case 'device': {
        const deviceName = ctx.args[1] as string;
        if (!deviceName)
          throw new Error(
            `Usage: set device <name>. Available: ${browser.listDevices().join(', ')}`,
          );
        await browser.emulateDevice(client, sessionId, deviceName);
        output.printSuccess(`Emulating device: ${deviceName}`);
        break;
      }
      case 'geo': {
        const lat = parseFloat(ctx.args[1] as string);
        const lon = parseFloat(ctx.args[2] as string);
        const acc = parseFloat(ctx.args[3] as string) || 100;
        if (Number.isNaN(lat) || Number.isNaN(lon))
          throw new Error('Usage: set geo <latitude> <longitude> [accuracy]');
        await browser.setGeolocation(client, sessionId, lat, lon, acc);
        output.printSuccess(`Geolocation set: ${lat}, ${lon}`);
        break;
      }
      case 'offline': {
        const offlineArg = ctx.args[1];
        if (offlineArg === undefined) throw new Error('Usage: set offline <true|false>');
        const enabled = offlineArg === 'true';
        await browser.setOfflineMode(client, sessionId, enabled);
        output.printSuccess(`Offline mode: ${enabled}`);
        break;
      }
      case 'media': {
        const scheme = ctx.args[1] as 'dark' | 'light' | 'no-preference';
        if (!scheme) throw new Error('Usage: set media dark|light|no-preference');
        await browser.setColorScheme(client, sessionId, scheme);
        output.printSuccess(`Color scheme: ${scheme}`);
        break;
      }
      case 'credentials': {
        const username = ctx.args[1] as string;
        const password = ctx.args[2] as string;
        if (!username || !password) throw new Error('Usage: set credentials <username> <password>');
        await browser.setBasicAuth(client, sessionId, username, password);
        output.printSuccess('Basic auth credentials set');
        break;
      }
      case 'useragent': {
        const ua = ctx.args[1] as string;
        if (!ua) throw new Error('Usage: set useragent "<user-agent-string>"');
        await browser.setUserAgent(client, sessionId, ua);
        output.printSuccess('User agent set');
        break;
      }
      default:
        throw new Error(
          `Unknown setting: ${setting}. Use: viewport|device|geo|offline|media|credentials|useragent`,
        );
    }

    return { success: true };
  },
};

export const pushstateCommand: Command = {
  name: 'pushstate',
  description: 'SPA navigation via pushState. Usage: monomind browse pushstate /path',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const url = ctx.args[0] as string;
    if (!url) throw new Error('Usage: monomind browse pushstate <url>');
    await browser.pushState(client, sessionId, url);
    // SPA navigation changes what's on the page without a full page load —
    // refs captured before this pushState call may now resolve to different content.
    session.refs = new Map();
    await browser.clearRefCache(session.port);
    output.printSuccess(`pushState: ${url}`);
    return { success: true };
  },
};
