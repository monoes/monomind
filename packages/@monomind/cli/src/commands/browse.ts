/**
 * Browse Command — Native browser automation via Chrome DevTools Protocol
 * Provides ref-based element model and token-efficient accessibility snapshots
 */

import type { Command, CommandContext, CommandResult } from '../types.js';
import { output } from '../output.js';
import { createWorkflowCommand } from './browse-workflow.js';
import { createActionCommand } from './browse-action.js';
import { createPlatformCommand } from './browse-platform.js';
import type { CdpClient, ElementRef, NetworkRoute, FindAction } from '@monoes/monobrowse';

// Runtime state (single session per CLI process)
let _client: CdpClient | null = null;
let _sessionId = '';
let _targetId = '';
let _port = 9222;
let _refs: Map<string, ElementRef> = new Map();

async function getBrowser() {
  return import('@monoes/monobrowse');
}

async function ensureConnected(port: number, targetId?: string) {
  const browser = await getBrowser();
  if (!_client || !_client.isConnected()) {
    if (_client && _sessionId) {
      browser.teardownRouteInterception(_sessionId);
      browser.stopRequestCapture(_sessionId);
      browser.teardownDialogHandling(_sessionId);
      browser.teardownConsoleCapture(_sessionId);
      _client.close();
    }
    _port = await browser.launchBrowser({ port, headless: false });
    const conn = await browser.connectToTarget(_port, targetId);
    _client = conn.client;
    _sessionId = conn.sessionId;
    _targetId = conn.target.id;
    _refs = new Map();
  }
  return { client: _client!, sessionId: _sessionId, targetId: _targetId };
}

function print(msg: string) {
  process.stdout.write(msg + '\n');
}

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

const openCommand: Command = {
  name: 'open',
  description: 'Open a URL in the browser. Usage: monomind browse open <url>',
  options: [
    { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
    { name: 'headless', type: 'boolean', description: 'Run in headless mode', default: false },
    { name: 'session', short: 's', type: 'string', description: 'Session name to restore' },
    { name: 'state', type: 'string', description: 'State file to load' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const url = ctx.args[0] as string;
    if (!url) throw new Error('URL required. Usage: monomind browse open <url>');

    const port = (ctx.flags.port as number) ?? 9222;
    const browser = await getBrowser();

    if (_client) {
      const prevSid = _sessionId;
      const prevClient = _client;
      if (browser.getHarStatus(prevSid).recording) {
        try { await browser.stopHarRecording(prevClient, prevSid); } catch { /* ignore */ }
      }
      if (browser.getTraceStatus(prevSid)) {
        try { await browser.stopTrace(prevClient, prevSid); } catch { /* ignore */ }
      }
      if (browser.isProfilingActive(prevSid)) {
        try { await browser.stopCpuProfile(prevClient, prevSid); } catch { /* ignore */ }
      }
      browser.teardownRouteInterception(prevSid);
      browser.stopRequestCapture(prevSid);
      browser.teardownDialogHandling(prevSid);
      browser.teardownConsoleCapture(prevSid);
      prevClient.close();
      _client = null;
      _sessionId = '';
      _targetId = '';
      _refs = new Map();
    }

    _port = await browser.launchBrowser({ port, headless: ctx.flags.headless as boolean });
    const conn = await browser.connectToTarget(_port);
    _client = conn.client;
    _sessionId = conn.sessionId;
    _targetId = conn.target.id;
    _refs = new Map();

    if (ctx.flags.state && ctx.flags.session) {
      output.printWarning('Both --state and --session provided; --state takes precedence');
    }
    if (ctx.flags.state) {
      await browser.loadStateFile(_client, _sessionId, ctx.flags.state as string);
    } else if (ctx.flags.session) {
      await browser.loadSession(_client, _sessionId, ctx.flags.session as string);
    }

    await browser.openUrl(_client, _sessionId, url);
    const currentUrl = await browser.getCurrentUrl(_client, _sessionId);
    const title = await browser.getCurrentTitle(_client, _sessionId);

    output.printSuccess(`Opened: ${title} (${currentUrl})`);
    return { success: true, data: { url: currentUrl, title } };
  },
};

const snapshotCommand: Command = {
  name: 'snapshot',
  description: 'Capture accessibility snapshot with ref-based element handles (@e1, @e2, ...)',
  options: [
    { name: 'interactive', short: 'i', type: 'boolean', description: 'Interactive elements only (93% token reduction)', default: false },
    { name: 'compact', short: 'c', type: 'boolean', description: 'Compact output format', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    { name: 'depth', short: 'd', type: 'number', description: 'Max depth of AX tree to show' },
    { name: 'selector', short: 's', type: 'string', description: 'Scope snapshot to a CSS selector' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const result = await browser.captureSnapshot(client, sessionId, {
      interactiveOnly: ctx.flags.interactive as boolean,
      compact: ctx.flags.compact as boolean,
      maxDepth: ctx.flags.depth as number | undefined,
      selector: ctx.flags.selector as string | undefined,
    });

    _refs = result.refs;

    if (ctx.flags.json) {
      const refsObj = Object.fromEntries([...result.refs.entries()].map(([k, v]) => [k, v]));
      print(JSON.stringify({ url: result.url, title: result.title, refs: refsObj, snapshot: result.text }));
    } else {
      print(`[${result.title}] ${result.url}\n`);
      print(result.text);
    }

    return { success: true, data: result };
  },
};

const clickCommand: Command = {
  name: 'click',
  description: 'Click an element by ref (@e1) or coordinates. Usage: monomind browse click @e1',
  options: [
    { name: 'right', type: 'boolean', description: 'Right-click', default: false },
    { name: 'double', type: 'boolean', description: 'Double-click', default: false },
    { name: 'x', type: 'number', description: 'X coordinate (for point click)' },
    { name: 'y', type: 'number', description: 'Y coordinate (for point click)' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg && ctx.flags.x === undefined) throw new Error('Ref (@e1) or --x/--y required');

    if (ctx.flags.x !== undefined && ctx.flags.y !== undefined) {
      await browser.clickPoint(client, sessionId, ctx.flags.x as number, ctx.flags.y as number);
      output.printSuccess(`Clicked at (${ctx.flags.x}, ${ctx.flags.y})`);
      return { success: true };
    }

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);

    await browser.clickElement(client, sessionId, ref, {
      button: ctx.flags.right ? 'right' : 'left',
      clickCount: ctx.flags.double ? 2 : 1,
    });

    output.printSuccess(`Clicked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const fillCommand: Command = {
  name: 'fill',
  description: 'Fill an input element. Usage: monomind browse fill @e1 "text value"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || value === undefined) throw new Error('Usage: monomind browse fill @e1 "value"');

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);

    await browser.fillElement(client, sessionId, ref, value);
    output.printSuccess(`Filled: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const pressCommand: Command = {
  name: 'press',
  description: 'Press a keyboard key. Usage: monomind browse press Enter',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const key = ctx.args[0] as string;
    if (!key) throw new Error('Key required. E.g.: monomind browse press Enter');

    await browser.pressKey(client, sessionId, key);
    output.printSuccess(`Pressed: ${key}`);
    return { success: true };
  },
};

const waitCommand: Command = {
  name: 'wait',
  description: 'Wait for a condition to be met before proceeding',
  options: [
    { name: 'url', type: 'string', description: 'Wait for URL matching glob pattern' },
    { name: 'text', type: 'string', description: 'Wait for text to appear in page' },
    { name: 'not-text', type: 'string', description: 'Wait for text to disappear from page' },
    { name: 'selector', type: 'string', description: 'Wait for CSS selector to appear' },
    { name: 'load', type: 'string', description: 'Wait for load event: load|networkidle|domcontentloaded' },
    { name: 'fn', type: 'string', description: 'Wait until JS expression returns truthy' },
    { name: 'ms', type: 'number', description: 'Wait N milliseconds' },
    { name: 'timeout', short: 't', type: 'number', description: 'Timeout in ms', default: 30000 },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
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
      const timeout = Number.isFinite(rawTimeout) ? Math.max(100, Math.min(rawTimeout, 300_000)) : 30000; // cap at 5min
      const interval = 200;
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const result = await browser.evaluateJs(client, sessionId, expr);
        if (result) { output.printSuccess('Wait function returned truthy'); return { success: true }; }
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
        const text = await browser.evaluateJs(client, sessionId, 'document.body?.innerText ?? ""') as string;
        if (!text.includes(target)) { output.printSuccess('Text disappeared'); return { success: true }; }
        await new Promise((r) => setTimeout(r, interval));
      }
      throw new Error(`Timeout waiting for text to disappear: "${target}"`);
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

const screenshotCommand: Command = {
  name: 'screenshot',
  description: 'Capture a screenshot. Usage: monomind browse screenshot [path]',
  options: [
    { name: 'full', type: 'boolean', description: 'Full page screenshot', default: false },
    { name: 'format', type: 'string', description: 'Format: png|jpeg|webp', default: 'png' },
    { name: 'quality', type: 'number', description: 'Quality 0-100 for jpeg/webp', default: 80 },
    { name: 'json', type: 'boolean', description: 'Output JSON with path', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const result = await browser.captureScreenshot(client, sessionId, {
      path: ctx.args[0] as string,
      fullPage: ctx.flags.full as boolean,
      format: ctx.flags.format as 'png' | 'jpeg' | 'webp',
      quality: ctx.flags.quality as number,
    });

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { path: result.path } }));
    } else {
      output.printSuccess(`Screenshot saved: ${result.path}`);
    }

    return { success: true, data: result };
  },
};

const getCommand: Command = {
  name: 'get',
  description: 'Get page info. Usage: monomind browse get url|title|text|html|value|attr|count|box|styles [@ref] [attrName]',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const what = ctx.args[0] as string;
    if (!what) throw new Error('Usage: monomind browse get url|title|text|html|value|attr|count|box|styles');

    let value: unknown;

    switch (what) {
      case 'url':
        value = await browser.getCurrentUrl(client, sessionId);
        break;
      case 'title':
        value = await browser.getCurrentTitle(client, sessionId);
        break;
      case 'text': {
        const refArg = ctx.args[1] as string | undefined;
        if (refArg) {
          const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
          const ref = _refs.get(refKey);
          if (!ref) throw new Error(`Ref @${refKey} not found`);
          const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
          if (!objectId) throw new Error('Element not in DOM');
          const result = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
            functionDeclaration: 'function() { return this.innerText || this.textContent || ""; }',
            objectId,
            returnByValue: true,
          }, sessionId);
          value = result.result?.value ?? '';
        } else {
          value = (await browser.evaluateJs(client, sessionId, 'document.body?.innerText ?? ""')) as string;
        }
        break;
      }
      case 'html':
        value = (await browser.evaluateJs(client, sessionId, 'document.documentElement.outerHTML')) as string;
        break;
      case 'value': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get value @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = _refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
          functionDeclaration: 'function() { return this.value ?? null; }',
          objectId, returnByValue: true,
        }, sessionId);
        value = r.result?.value ?? null;
        break;
      }
      case 'attr': {
        const refArg = ctx.args[1] as string;
        const attrName = ctx.args[2] as string;
        if (!refArg || !attrName) throw new Error('Usage: monomind browse get attr @ref <attrName>');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = _refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
          functionDeclaration: `function() { return this.getAttribute(${JSON.stringify(attrName)}); }`,
          objectId, returnByValue: true,
        }, sessionId);
        value = r.result?.value ?? null;
        break;
      }
      case 'count': {
        const selector = ctx.args[1] as string;
        if (!selector) throw new Error('Usage: monomind browse get count <cssSelector>');
        value = await browser.evaluateJs(client, sessionId, `document.querySelectorAll(${JSON.stringify(selector)}).length`);
        break;
      }
      case 'box': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get box @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = _refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        value = await browser.getElementBox(client, sessionId, ref);
        break;
      }
      case 'styles': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get styles @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = _refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
          functionDeclaration: 'function() { const s = window.getComputedStyle(this); return JSON.stringify(Object.fromEntries([...s].map(k => [k, s.getPropertyValue(k)]))); }',
          objectId, returnByValue: true,
        }, sessionId);
        try { value = JSON.parse(r.result?.value ?? '{}'); } catch { value = {}; }
        break;
      }
      default:
        throw new Error(`Unknown: ${what}. Use: url|title|text|html|value|attr|count|box|styles`);
    }

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { [what]: value } }));
    } else {
      print(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
    }

    return { success: true, data: { [what]: value } };
  },
};

const scrollCommand: Command = {
  name: 'scroll',
  description: 'Scroll the page. Usage: monomind browse scroll up|down|left|right',
  options: [
    { name: 'amount', short: 'a', type: 'number', description: 'Pixels to scroll', default: 300 },
    { name: 'ref', type: 'string', description: 'Element ref to scroll within' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const direction = ctx.args[0] as 'up' | 'down' | 'left' | 'right';
    if (!direction) throw new Error('Usage: monomind browse scroll up|down|left|right');

    let ref: ElementRef | undefined;
    if (ctx.flags.ref) {
      const refKey = (ctx.flags.ref as string).startsWith('@')
        ? (ctx.flags.ref as string).slice(1)
        : ctx.flags.ref as string;
      ref = _refs.get(refKey);
    }

    await browser.scrollElement(client, sessionId, direction, ctx.flags.amount as number, ref);
    output.printSuccess(`Scrolled ${direction}`);
    return { success: true };
  },
};

const navigateCommand: Command = {
  name: 'navigate',
  description: 'Navigate browser history. Usage: monomind browse navigate back|forward|reload',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const direction = ctx.args[0] as string;
    if (!direction) throw new Error('Usage: monomind browse navigate back|forward|reload');

    if (direction === 'back' || direction === 'forward') {
      // Pre-register frame-start listener BEFORE JS navigation to avoid the race
      // where history.back/forward() returns before the browser issues any requests
      let offFrameStarted: () => void = () => {};
      const frameStartedPromise = new Promise<void>((resolve) => {
        offFrameStarted = client.on('Page.frameStartedLoading', (_params, sid) => {
          if (sid === sessionId) { const off = offFrameStarted; offFrameStarted = () => {}; off(); resolve(); }
        });
      });
      try {
        await client.send('Runtime.evaluate', {
          expression: direction === 'back' ? 'history.back()' : 'history.forward()',
        }, sessionId);
        let fallbackHandle: ReturnType<typeof setTimeout> | undefined;
        const fallbackPromise = new Promise<void>((r) => { fallbackHandle = setTimeout(r, 2000); });
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

    output.printSuccess(`Navigated: ${direction}`);
    return { success: true };
  },
};

const setCommand: Command = {
  name: 'set',
  description: 'Configure browser settings. Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const setting = ctx.args[0] as string;
    if (!setting) throw new Error('Usage: monomind browse set viewport|device|geo|offline|media|credentials|useragent <args>');

    switch (setting) {
      case 'viewport': {
        const width = parseInt(ctx.args[1] as string, 10);
        const height = parseInt(ctx.args[2] as string, 10);
        const dpr = parseFloat(ctx.args[3] as string) || undefined;
        if (isNaN(width) || isNaN(height)) throw new Error('Usage: set viewport <width> <height> [dpr]');
        await client.send('Emulation.setDeviceMetricsOverride', {
          width, height, deviceScaleFactor: dpr ?? 1, mobile: false,
        }, sessionId);
        output.printSuccess(`Viewport set to ${width}x${height}${dpr ? ` @${dpr}x` : ''}`);
        break;
      }
      case 'device': {
        const deviceName = ctx.args[1] as string;
        if (!deviceName) throw new Error(`Usage: set device <name>. Available: ${browser.listDevices().join(', ')}`);
        await browser.emulateDevice(client, sessionId, deviceName);
        output.printSuccess(`Emulating device: ${deviceName}`);
        break;
      }
      case 'geo': {
        const lat = parseFloat(ctx.args[1] as string);
        const lon = parseFloat(ctx.args[2] as string);
        const acc = parseFloat(ctx.args[3] as string) || 100;
        if (isNaN(lat) || isNaN(lon)) throw new Error('Usage: set geo <latitude> <longitude> [accuracy]');
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
        throw new Error(`Unknown setting: ${setting}. Use: viewport|device|geo|offline|media|credentials|useragent`);
    }

    return { success: true };
  },
};

const stateCommand: Command = {
  name: 'state',
  description: 'Manage browser session state. Usage: monomind browse state save|load|list [name]',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse state save|load|list [name]');

    switch (action) {
      case 'list': {
        const sessions = await browser.listSessions();
        if (sessions.length === 0) {
          output.printInfo('No saved sessions');
        } else {
          output.printInfo('Saved sessions:');
          for (const s of sessions) print(`  ${s}`);
        }
        return { success: true, data: { sessions } };
      }
      case 'save': {
        const { client, sessionId } = await ensureConnected(_port);
        const target = ctx.args[1] as string;
        if (!target) throw new Error('Usage: monomind browse state save <name-or-file>');
        const url = await browser.getCurrentUrl(client, sessionId);
        const title = await browser.getCurrentTitle(client, sessionId);
        if (target.endsWith('.json')) {
          await browser.saveStateFile(client, sessionId, _targetId, target, url, title);
          output.printSuccess(`State saved to ${target}`);
        } else {
          const path = await browser.saveSession(client, sessionId, _targetId, target, url, title);
          output.printSuccess(`Session "${target}" saved to ${path}`);
        }
        return { success: true };
      }
      case 'load': {
        const { client, sessionId } = await ensureConnected(_port);
        const target = ctx.args[1] as string;
        if (!target) throw new Error('Usage: monomind browse state load <name-or-file>');
        if (target.endsWith('.json')) {
          await browser.loadStateFile(client, sessionId, target);
        } else {
          await browser.loadSession(client, sessionId, target);
        }
        output.printSuccess(`State loaded from ${target}`);
        return { success: true };
      }
      case 'show': {
        const { client: c, sessionId: sid } = await ensureConnected(_port);
        const url = await browser.getCurrentUrl(c, sid);
        const title = await browser.getCurrentTitle(c, sid);
        const cookies = await browser.getCookies(c, sid);
        const ls = await browser.getAllLocalStorage(c, sid);
        const info = { url, title, cookies: cookies.length, localStorage: Object.keys(ls).length, refs: _refs.size };
        print(JSON.stringify(info, null, 2));
        return { success: true, data: info };
      }
      case 'clear': {
        const { client: c, sessionId: sid } = await ensureConnected(_port);
        await browser.clearCookies(c, sid);
        await browser.clearLocalStorage(c, sid);
        await browser.clearSessionStorage(c, sid);
        _refs = new Map();
        output.printSuccess('Browser state cleared (cookies, localStorage, sessionStorage, refs)');
        return { success: true };
      }
      default:
        throw new Error(`Unknown action: ${action}. Use: save|load|list|show|clear`);
    }
  },
};

const networkCommand: Command = {
  name: 'network',
  description: 'Network interception and cookie management',
  options: [
    { name: 'pattern', type: 'string', description: 'URL pattern for route (glob)' },
    { name: 'abort', type: 'boolean', description: 'Abort matching requests' },
    { name: 'fulfill', type: 'string', description: 'JSON response body' },
    { name: 'status', type: 'number', description: 'HTTP status for fulfill', default: 200 },
    { name: 'headers', type: 'string', description: 'JSON headers object' },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse network route|unroute|cookies|headers|requests');

    switch (action) {
      case 'route': {
        const pattern = ctx.flags.pattern as string;
        if (!pattern) throw new Error('--pattern required for network route');
        const routes: NetworkRoute[] = [{
          pattern,
          action: ctx.flags.abort ? 'abort' : ctx.flags.fulfill ? 'fulfill' : 'continue',
          response: ctx.flags.fulfill ? {
            status: ctx.flags.status as number,
            body: ctx.flags.fulfill as string,
            headers: ctx.flags.headers ? JSON.parse(ctx.flags.headers as string) : {},
          } : undefined,
        }];
        await browser.setupRoutes(client, sessionId, routes);
        output.printSuccess(`Network route set: ${pattern}`);
        break;
      }
      case 'unroute':
        await browser.disableInterception(client, sessionId);
        output.printSuccess('Network interception disabled');
        break;
      case 'cookies': {
        const cookies = await browser.getCookies(client, sessionId);
        print(JSON.stringify(cookies, null, 2));
        return { success: true, data: { cookies } };
      }
      case 'headers': {
        const headers = ctx.flags.headers as string;
        if (!headers) throw new Error('--headers required (JSON string)');
        await browser.setExtraHeaders(client, sessionId, JSON.parse(headers));
        output.printSuccess('Extra headers set');
        break;
      }
      case 'capture': {
        const subAction = ctx.args[1] as string ?? 'start';
        if (subAction === 'start') {
          browser.startRequestCapture(client, sessionId);
          output.printSuccess('Request capture started');
        } else if (subAction === 'stop') {
          browser.stopRequestCapture(sessionId);
          output.printSuccess('Request capture stopped');
        } else if (subAction === 'clear') {
          browser.clearCapturedRequests(sessionId);
          output.printSuccess('Captured requests cleared');
        }
        break;
      }
      case 'requests': {
        const reqs = browser.getCapturedRequests(sessionId);
        if (ctx.flags.json) print(JSON.stringify({ data: reqs }));
        else {
          if (reqs.length === 0) { output.printInfo('No captured requests. Run: network capture start'); }
          else for (const r of reqs) print(`  ${r.method ?? 'GET'} ${r.status ?? '-'} ${r.url}`);
        }
        return { success: true, data: { requests: reqs } };
      }
      default:
        throw new Error(`Unknown: ${action}. Use: route|unroute|cookies|headers|capture|requests`);
    }

    return { success: true };
  },
};

const evalCommand: Command = {
  name: 'eval',
  description: 'Evaluate JavaScript in page context. Usage: monomind browse eval "document.title"',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();

    const expr = ctx.args[0] as string;
    if (!expr) throw new Error('Usage: monomind browse eval "<expression>"');

    const result = await browser.evaluateJs(client, sessionId, expr);

    if (ctx.flags.json) {
      print(JSON.stringify({ data: result }));
    } else {
      print(String(result ?? ''));
    }

    return { success: true, data: { result } };
  },
};

const closeCommand: Command = {
  name: 'close',
  description: 'Close the active browser session',
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    if (_client) {
      const browser = await getBrowser();
      const sid = _sessionId;
      const client = _client;
      // Tear down per-session Maps and listeners before closing
      if (browser.getHarStatus(sid).recording) {
        try { await browser.stopHarRecording(client, sid); } catch { /* ignore */ }
      }
      if (browser.getTraceStatus(sid)) {
        try { await browser.stopTrace(client, sid); } catch { /* ignore */ }
      }
      if (browser.isProfilingActive(sid)) {
        try { await browser.stopCpuProfile(client, sid); } catch { /* ignore */ }
      }
      browser.teardownRouteInterception(sid);
      browser.stopRequestCapture(sid);
      browser.teardownDialogHandling(sid);
      browser.teardownConsoleCapture(sid);
      client.close();
      _client = null;
      _sessionId = '';
      _targetId = '';
      _refs = new Map();
      output.printSuccess('Browser session closed');
    } else {
      output.printInfo('No active browser session');
    }
    return { success: true };
  },
};

// ---------------------------------------------------------------------------
// Additional subcommands
// ---------------------------------------------------------------------------

const dblclickCommand: Command = {
  name: 'dblclick',
  description: 'Double-click an element. Usage: monomind browse dblclick @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse dblclick @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.clickElement(client, sessionId, ref, { clickCount: 2 });
    output.printSuccess(`Double-clicked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const focusCommand: Command = {
  name: 'focus',
  description: 'Focus an element. Usage: monomind browse focus @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse focus @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.focusElement(client, sessionId, ref);
    output.printSuccess(`Focused: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const typeCommand: Command = {
  name: 'type',
  description: 'Type text into element (appends, does not clear). Usage: monomind browse type @e1 "text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || value === undefined) throw new Error('Usage: monomind browse type @e1 "value"');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.typeIntoElement(client, sessionId, ref, value);
    output.printSuccess(`Typed into: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const keyboardCommand: Command = {
  name: 'keyboard',
  description: 'Keyboard commands. Usage: monomind browse keyboard type "text" | inserttext "text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    const text = ctx.args[1] as string;
    if (!action || !text) throw new Error('Usage: monomind browse keyboard type|inserttext "text"');
    await browser.typeText(client, sessionId, text);
    output.printSuccess(`Keyboard ${action}: ${text.length} chars`);
    return { success: true };
  },
};

const keydownCommand: Command = {
  name: 'keydown',
  description: 'Hold key down. Usage: monomind browse keydown Shift',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const key = ctx.args[0] as string;
    if (!key) throw new Error('Usage: monomind browse keydown <key>');
    await browser.keyDown(client, sessionId, key);
    output.printSuccess(`Key down: ${key}`);
    return { success: true };
  },
};

const keyupCommand: Command = {
  name: 'keyup',
  description: 'Release held key. Usage: monomind browse keyup Shift',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const key = ctx.args[0] as string;
    if (!key) throw new Error('Usage: monomind browse keyup <key>');
    await browser.keyUp(client, sessionId, key);
    output.printSuccess(`Key up: ${key}`);
    return { success: true };
  },
};

const hoverCommand: Command = {
  name: 'hover',
  description: 'Hover over an element. Usage: monomind browse hover @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse hover @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.hoverElement(client, sessionId, ref);
    output.printSuccess(`Hovered: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const selectCommand: Command = {
  name: 'select',
  description: 'Select a dropdown option. Usage: monomind browse select @e1 "Option text"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    if (!refArg || !value) throw new Error('Usage: monomind browse select @e1 "value"');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.selectOption(client, sessionId, ref, value);
    output.printSuccess(`Selected: "${value}"`);
    return { success: true };
  },
};

const checkCommand: Command = {
  name: 'check',
  description: 'Check a checkbox. Usage: monomind browse check @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse check @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.checkElement(client, sessionId, ref, true);
    output.printSuccess(`Checked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const uncheckCommand: Command = {
  name: 'uncheck',
  description: 'Uncheck a checkbox. Usage: monomind browse uncheck @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse uncheck @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.checkElement(client, sessionId, ref, false);
    output.printSuccess(`Unchecked: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const scrollIntoViewCommand: Command = {
  name: 'scrollintoview',
  description: 'Scroll element into view. Usage: monomind browse scrollintoview @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse scrollintoview @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.scrollIntoView(client, sessionId, ref);
    output.printSuccess(`Scrolled into view: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const dragCommand: Command = {
  name: 'drag',
  description: 'Drag element to another element. Usage: monomind browse drag @e1 @e2',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const srcArg = ctx.args[0] as string;
    const tgtArg = ctx.args[1] as string;
    if (!srcArg || !tgtArg) throw new Error('Usage: monomind browse drag @e1 @e2');
    const srcKey = srcArg.startsWith('@') ? srcArg.slice(1) : srcArg;
    const tgtKey = tgtArg.startsWith('@') ? tgtArg.slice(1) : tgtArg;
    const src = await browser.resolveRef(client, sessionId, _refs, srcKey);
    const tgt = await browser.resolveRef(client, sessionId, _refs, tgtKey);
    await browser.dragAndDrop(client, sessionId, src, tgt);
    output.printSuccess(`Dragged @${srcKey} to @${tgtKey}`);
    return { success: true };
  },
};

const uploadCommand: Command = {
  name: 'upload',
  description: 'Upload files to a file input. Usage: monomind browse upload @e1 ./file.pdf',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    const files = ctx.args.slice(1) as string[];
    if (!refArg || files.length === 0) throw new Error('Usage: monomind browse upload @e1 <file1> [file2...]');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.uploadFile(client, sessionId, ref, files);
    output.printSuccess(`Uploaded ${files.length} file(s) to @${refKey}`);
    return { success: true };
  },
};

const mouseCommand: Command = {
  name: 'mouse',
  description: 'Fine-grained mouse control. Usage: monomind browse mouse move|down|up|wheel <args>',
  options: [
    { name: 'button', type: 'string', description: 'Button: left|right|middle', default: 'left' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action) {
      case 'move': {
        const x = parseFloat(ctx.args[1] as string);
        const y = parseFloat(ctx.args[2] as string);
        await browser.mouseMove(client, sessionId, x, y);
        output.printSuccess(`Mouse moved to (${x}, ${y})`);
        break;
      }
      case 'down': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const button = (ctx.flags.button as 'left' | 'right' | 'middle') ?? 'left';
        await browser.mouseDown(client, sessionId, x, y, button);
        output.printSuccess(`Mouse down at (${x}, ${y})`);
        break;
      }
      case 'up': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const button = (ctx.flags.button as 'left' | 'right' | 'middle') ?? 'left';
        await browser.mouseUp(client, sessionId, x, y, button);
        output.printSuccess(`Mouse up at (${x}, ${y})`);
        break;
      }
      case 'wheel': {
        const x = parseFloat(ctx.args[1] as string) || 0;
        const y = parseFloat(ctx.args[2] as string) || 0;
        const dy = parseFloat(ctx.args[3] as string) || 0;
        const dx = parseFloat(ctx.args[4] as string) || 0;
        await browser.mouseWheel(client, sessionId, x, y, dy, dx);
        output.printSuccess(`Mouse wheel (${dx}, ${dy})`);
        break;
      }
      default:
        throw new Error('Usage: monomind browse mouse move|down|up|wheel <args>');
    }
    return { success: true };
  },
};

const clipboardCommand: Command = {
  name: 'clipboard',
  description: 'Clipboard operations. Usage: monomind browse clipboard read|write|copy|paste',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action) {
      case 'read': {
        const text = await browser.readClipboard(client, sessionId);
        print(text);
        return { success: true, data: { text } };
      }
      case 'write': {
        const text = ctx.args[1] as string;
        if (!text) throw new Error('Usage: monomind browse clipboard write "text"');
        await browser.writeClipboard(client, sessionId, text);
        output.printSuccess('Clipboard written');
        break;
      }
      case 'copy': {
        const mod = process.platform === 'darwin' ? 4 : 2; // Meta/Cmd on macOS, Ctrl elsewhere
        await browser.pressKeyCombo(client, sessionId, 'c', mod);
        output.printSuccess('Copy sent');
        break;
      }
      case 'paste': {
        const mod = process.platform === 'darwin' ? 4 : 2;
        await browser.pressKeyCombo(client, sessionId, 'v', mod);
        output.printSuccess('Paste sent');
        break;
      }
      default:
        throw new Error('Usage: monomind browse clipboard read|write|copy|paste');
    }
    return { success: true };
  },
};

const dialogCommand: Command = {
  name: 'dialog',
  description: 'Handle browser dialogs. Usage: monomind browse dialog accept|dismiss|status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action) {
      case 'accept': {
        const text = ctx.args[1] as string | undefined;
        await browser.acceptDialog(client, sessionId, text);
        output.printSuccess('Dialog accepted');
        break;
      }
      case 'dismiss':
        await browser.dismissDialog(client, sessionId);
        output.printSuccess('Dialog dismissed');
        break;
      case 'status': {
        const info = browser.getDialogStatus(sessionId);
        if (info) {
          print(`Dialog open: type=${info.type} message="${info.message}"`);
        } else {
          print('No dialog open');
        }
        return { success: true, data: { dialog: info } };
      }
      default:
        throw new Error('Usage: monomind browse dialog accept|dismiss|status');
    }
    return { success: true };
  },
};

const frameCommand: Command = {
  name: 'frame',
  description: 'Switch to iframe or back to main. Usage: monomind browse frame "#frame-id" | frame main',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const target = ctx.args[0] as string;
    if (!target) throw new Error('Usage: monomind browse frame <selector>|main');

    if (target === 'main') {
      output.printSuccess('Switched to main frame');
    } else {
      const frameSrc = await browser.switchToFrame(client, sessionId, target);
      output.printSuccess(`Switched to frame: ${frameSrc ?? target}`);
    }
    return { success: true };
  },
};

const tabCommand: Command = {
  name: 'tab',
  description: 'Tab management. Usage: monomind browse tab list|new|close [url]',
  options: [
    { name: 'label', type: 'string', description: 'Label for new tab' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action ?? 'list') {
      case 'list': {
        const tabs = await browser.listTabs(_port);
        for (const t of tabs) print(`  ${t.id}: ${t.title} (${t.url})`);
        return { success: true, data: { tabs } };
      }
      case 'new': {
        const url = ctx.args[1] as string | undefined;
        const tab = await browser.newTab(_port, url);
        output.printSuccess(`New tab: ${tab.id} ${url ?? ''}`);
        return { success: true, data: { tab } };
      }
      case 'close': {
        const tabId = ctx.args[1] as string;
        if (!tabId) throw new Error('Usage: monomind browse tab close <tabId>');
        if (tabId === _targetId) {
          const sid = _sessionId;
          // Stop profiling before closing the tab so CDP commands still reach the live session
          if (browser.getHarStatus(sid).recording) {
            try { await browser.stopHarRecording(client, sid); } catch { /* ignore */ }
          }
          if (browser.getTraceStatus(sid)) {
            try { await browser.stopTrace(client, sid); } catch { /* ignore */ }
          }
          if (browser.isProfilingActive(sid)) {
            try { await browser.stopCpuProfile(client, sid); } catch { /* ignore */ }
          }
          browser.teardownRouteInterception(sid);
          browser.stopRequestCapture(sid);
          browser.teardownDialogHandling(sid);
          browser.teardownConsoleCapture(sid);
          await browser.closeTab(client, sessionId, tabId);
          client.close();
          _client = null;
          _sessionId = '';
          _targetId = '';
          _refs = new Map();
        } else {
          await browser.closeTab(client, sessionId, tabId);
        }
        output.printSuccess(`Closed tab: ${tabId}`);
        break;
      }
      default: {
        // Attach to new tab FIRST — only tear down old session if that succeeds
        const newSid = await browser.activateTab(client, sessionId, action);
        const oldSid = _sessionId;
        if (browser.getHarStatus(oldSid).recording) {
          try { await browser.stopHarRecording(client, oldSid); } catch { /* ignore */ }
        }
        if (browser.getTraceStatus(oldSid)) {
          try { await browser.stopTrace(client, oldSid); } catch { /* ignore */ }
        }
        if (browser.isProfilingActive(oldSid)) {
          try { await browser.stopCpuProfile(client, oldSid); } catch { /* ignore */ }
        }
        await browser.disableInterception(client, oldSid).catch(() => {});
        browser.stopRequestCapture(oldSid);
        browser.teardownDialogHandling(oldSid);
        browser.teardownConsoleCapture(oldSid);
        _sessionId = newSid;
        _targetId = action;
        _refs = new Map();
        await browser.enableSessionDomains(client, _sessionId);
        output.printSuccess(`Switched to tab: ${action}`);
      }
    }
    return { success: true };
  },
};

const consoleLogCommand: Command = {
  name: 'console',
  description: 'View captured console messages. Usage: monomind browse console [--clear] [--json]',
  options: [
    { name: 'clear', type: 'boolean', description: 'Clear console messages', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    { name: 'errors-only', type: 'boolean', description: 'Show only errors', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const browser = await getBrowser();
    if (ctx.flags.clear) {
      browser.clearConsoleMessages(_sessionId);
      output.printSuccess('Console cleared');
      return { success: true };
    }
    const allMsgs = browser.getConsoleMessages(_sessionId);
    const msgs = ctx.flags['errors-only'] ? allMsgs.filter((m) => m.type === 'error') : allMsgs;
    if (ctx.flags.json) {
      print(JSON.stringify(msgs));
    } else {
      for (const m of msgs) {
        const prefix = m.type === 'error' ? '[ERROR]' : m.type === 'warn' ? '[WARN]' : '[LOG]';
        print(`${prefix} ${m.text}`);
      }
    }
    return { success: true, data: { messages: msgs } };
  },
};

const errorsCommand: Command = {
  name: 'errors',
  description: 'View page errors (uncaught JS exceptions). Usage: monomind browse errors [--clear]',
  options: [
    { name: 'clear', type: 'boolean', description: 'Clear errors', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const browser = await getBrowser();
    if (ctx.flags.clear) {
      browser.clearPageErrors(_sessionId);
      output.printSuccess('Errors cleared');
      return { success: true };
    }
    const errs = browser.getPageErrors(_sessionId);
    if (ctx.flags.json) {
      print(JSON.stringify(errs));
    } else if (errs.length === 0) {
      output.printSuccess('No page errors');
    } else {
      for (const e of errs) print(`[ERROR] ${e.text} (${e.url}:${e.lineNumber})`);
    }
    return { success: true, data: { errors: errs } };
  },
};

const storageCommand: Command = {
  name: 'storage',
  description: 'localStorage/sessionStorage management. Usage: monomind browse storage local|session [key] [--set val] [--clear]',
  options: [
    { name: 'set', type: 'string', description: 'Value to set for key' },
    { name: 'clear', type: 'boolean', description: 'Clear all storage', default: false },
    { name: 'remove', type: 'boolean', description: 'Remove a specific key', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const storageType = ctx.args[0] as string;
    const key = ctx.args[1] as string | undefined;

    if (!storageType) throw new Error('Usage: monomind browse storage local|session [key]');

    const isLocal = storageType === 'local';

    if (ctx.flags.clear) {
      if (isLocal) await browser.clearLocalStorage(client, sessionId);
      else await browser.clearSessionStorage(client, sessionId);
      output.printSuccess(`${storageType}Storage cleared`);
      return { success: true };
    }

    if (key && ctx.flags.set !== undefined) {
      if (isLocal) await browser.setLocalStorageKey(client, sessionId, key, ctx.flags.set as string);
      else await browser.setSessionStorageKey(client, sessionId, key, ctx.flags.set as string);
      output.printSuccess(`Set ${key}`);
      return { success: true };
    }

    if (key && ctx.flags.remove) {
      if (isLocal) await browser.removeLocalStorageKey(client, sessionId, key);
      else await browser.removeSessionStorageKey(client, sessionId, key);
      output.printSuccess(`Removed ${key}`);
      return { success: true };
    }

    if (key) {
      const val = isLocal
        ? await browser.getLocalStorageKey(client, sessionId, key)
        : await browser.getSessionStorageKey(client, sessionId, key);
      if (ctx.flags.json) print(JSON.stringify({ data: val }));
      else print(val ?? '(null)');
      return { success: true, data: { value: val } };
    }

    const all = isLocal
      ? await browser.getAllLocalStorage(client, sessionId)
      : await browser.getAllSessionStorage(client, sessionId);
    if (ctx.flags.json) print(JSON.stringify(all));
    else {
      for (const [k, v] of Object.entries(all)) print(`  ${k}: ${v}`);
    }
    return { success: true, data: { storage: all } };
  },
};

const cookiesCommand: Command = {
  name: 'cookies',
  description: 'Cookie management. Usage: monomind browse cookies [list|set|clear]',
  options: [
    { name: 'name', type: 'string', description: 'Cookie name' },
    { name: 'value', type: 'string', description: 'Cookie value' },
    { name: 'domain', type: 'string', description: 'Cookie domain' },
    { name: 'curl', type: 'string', description: 'Import cookies from cURL dump file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = (ctx.args[0] as string) ?? 'list';

    switch (action) {
      case 'list': {
        const cookies = await browser.getCookies(client, sessionId);
        print(JSON.stringify(cookies, null, 2));
        return { success: true, data: { cookies } };
      }
      case 'set': {
        // Support both: cookies set --name n --value v  AND  cookies set <name> <value>
        const name = (ctx.flags.name as string) ?? (ctx.args[1] as string);
        const value = (ctx.flags.value as string) ?? (ctx.args[2] as string);
        if (!name || value === undefined) {
          throw new Error('Usage: monomind browse cookies set <name> <value> [--domain <d>]');
        }
        await browser.setCookies(client, sessionId, [{
          name,
          value,
          domain: ctx.flags.domain as string,
        }]);
        output.printSuccess(`Cookie set: ${name}`);
        break;
      }
      case 'clear':
        await browser.clearCookies(client, sessionId);
        output.printSuccess('Cookies cleared');
        break;
      default:
        throw new Error('Usage: monomind browse cookies list|set|clear');
    }
    return { success: true };
  },
};

const pdfCommand: Command = {
  name: 'pdf',
  description: 'Save page as PDF. Usage: monomind browse pdf [path]',
  options: [
    { name: 'landscape', type: 'boolean', description: 'Landscape orientation', default: false },
    { name: 'background', type: 'boolean', description: 'Print background', default: true },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const path = await browser.capturePdf(client, sessionId, {
      path: ctx.args[0] as string,
      landscape: ctx.flags.landscape as boolean,
      printBackground: ctx.flags.background as boolean,
    });
    output.printSuccess(`PDF saved: ${path}`);
    return { success: true, data: { path } };
  },
};

const isCommand: Command = {
  name: 'is',
  description: 'Check element state. Usage: monomind browse is visible|enabled|checked @e1',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const check = ctx.args[0] as string;
    const refArg = ctx.args[1] as string;
    if (!check || !refArg) throw new Error('Usage: monomind browse is visible|enabled|checked @e1');

    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);

    let result: boolean;
    switch (check) {
      case 'visible': result = await browser.isVisible(client, sessionId, ref); break;
      case 'enabled': result = await browser.isEnabled(client, sessionId, ref); break;
      case 'checked': result = await browser.isChecked(client, sessionId, ref); break;
      default: throw new Error(`Unknown check: ${check}. Use: visible|enabled|checked`);
    }

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { [check]: result } }));
    } else {
      print(result ? 'true' : 'false');
    }
    return { success: true, data: { [check]: result } };
  },
};

const findCommand: Command = {
  name: 'find',
  description: 'Find elements by semantic locators. Usage: monomind browse find role|text|label|placeholder|testid|selector <value> [action]',
  options: [
    { name: 'name', type: 'string', description: 'Filter by accessible name' },
    { name: 'exact', type: 'boolean', description: 'Require exact match', default: false },
    { name: 'nth', type: 'number', description: 'Find nth match' },
    { name: 'last', type: 'boolean', description: 'Find last match', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const locator = ctx.args[0] as string;
    const value = ctx.args[1] as string;
    const action = ctx.args[2] as FindAction | undefined;

    if (!locator || !value) throw new Error('Usage: monomind browse find role|text|label|placeholder|testid|selector <value> [action]');

    const opts = {
      name: ctx.flags.name as string,
      exact: ctx.flags.exact as boolean,
      nth: ctx.flags.nth as number,
      last: ctx.flags.last as boolean,
    };

    let ref: ElementRef | null = null;
    switch (locator) {
      case 'role': ref = await browser.findByRole(client, sessionId, _refs, value, opts); break;
      case 'text': ref = await browser.findByText(client, sessionId, _refs, value, opts); break;
      case 'label': ref = await browser.findByLabel(client, sessionId, _refs, value, opts); break;
      case 'placeholder': ref = await browser.findByPlaceholder(client, sessionId, _refs, value, opts); break;
      case 'selector': ref = await browser.findBySelector(client, sessionId, _refs, value, opts); break;
      case 'testid': {
        const sel = await browser.findByTestId(client, sessionId, value);
        if (!sel) { output.printWarning(`testid not found: ${value}`); return { success: false }; }
        output.printSuccess(`Found testid selector: ${sel}`);
        return { success: true, data: { selector: sel } };
      }
      default:
        throw new Error(`Unknown locator: ${locator}. Use: role|text|label|placeholder|testid|selector`);
    }

    if (!ref) {
      output.printWarning(`No element found: ${locator}="${value}"`);
      return { success: false };
    }

    output.printSuccess(`Found: ${ref.role} "${ref.name}" [@${ref.ref}]`);

    if (action) {
      switch (action) {
        case 'click': await browser.clickElement(client, sessionId, ref); break;
        case 'fill': {
          const fillValue = ctx.args[3] as string;
          await browser.fillElement(client, sessionId, ref, fillValue ?? '');
          break;
        }
        case 'type': {
          const typeValue = ctx.args[3] as string;
          await browser.typeIntoElement(client, sessionId, ref, typeValue ?? '');
          break;
        }
        case 'hover': await browser.hoverElement(client, sessionId, ref); break;
        case 'focus': await browser.focusElement(client, sessionId, ref); break;
        case 'check': await browser.checkElement(client, sessionId, ref, true); break;
        case 'uncheck': await browser.checkElement(client, sessionId, ref, false); break;
        case 'text': {
          const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
          if (objectId) {
            const r = await client.send<{ result: { value?: string } }>('Runtime.callFunctionOn', {
              functionDeclaration: 'function() { return this.innerText || this.textContent || ""; }',
              objectId,
              returnByValue: true,
            }, sessionId);
            print(r.result?.value ?? '');
          }
          break;
        }
      }
    }

    return { success: true, data: { ref } };
  },
};

const highlightCommand: Command = {
  name: 'highlight',
  description: 'Highlight an element for 2 seconds. Usage: monomind browse highlight @e1',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const refArg = ctx.args[0] as string;
    if (!refArg) throw new Error('Usage: monomind browse highlight @e1');
    const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
    const ref = await browser.resolveRef(client, sessionId, _refs, refKey);
    await browser.highlightElement(client, sessionId, ref);
    output.printSuccess(`Highlighted: ${ref.role} "${ref.name}"`);
    return { success: true };
  },
};

const pushstateCommand: Command = {
  name: 'pushstate',
  description: 'SPA navigation via pushState. Usage: monomind browse pushstate /path',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const url = ctx.args[0] as string;
    if (!url) throw new Error('Usage: monomind browse pushstate <url>');
    await browser.pushState(client, sessionId, url);
    output.printSuccess(`pushState: ${url}`);
    return { success: true };
  },
};

function tokenizeBatchCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of input.trim()) {
    if (inQuote) {
      if (ch === inQuote) { inQuote = null; }
      else { current += ch; }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

const batchCommand: Command = {
  name: 'batch',
  description: 'Execute multiple commands. Usage: monomind browse batch "open url" "snapshot -i" "click @e1"',
  options: [
    { name: 'bail', type: 'boolean', description: 'Stop on first error', default: false },
    { name: 'json', type: 'boolean', description: 'Input from JSON stdin', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const commands = ctx.args as string[];
    if (commands.length === 0) throw new Error('Usage: monomind browse batch "cmd1" "cmd2" ...');

    const results: Array<{ command: string; success: boolean; error?: string }> = [];
    for (const cmdStr of commands) {
      const parts = tokenizeBatchCommand(cmdStr);
      const subName = parts[0];
      const subArgs = parts.slice(1);

      const subCmd = browseCommand.subcommands?.find((s) => s.name === subName);
      if (!subCmd?.action) {
        const err = `Unknown command: ${subName}`;
        results.push({ command: cmdStr, success: false, error: err });
        if (ctx.flags.bail) break;
        continue;
      }

      try {
        const parsedFlags: CommandContext['flags'] = { _: [] };
        const consumedIndices = new Set<number>();
        // Parse --flags from subArgs, tracking which indices are flag names/values
        for (let i = 0; i < subArgs.length; i++) {
          if (subArgs[i].startsWith('--')) {
            consumedIndices.add(i);
            const key = subArgs[i].slice(2);
            const next = subArgs[i + 1];
            const optDef = subCmd.options?.find((o) => o.name === key);
            const isBooleanFlag = optDef?.type === 'boolean';
            if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
              // Non-boolean flags consume the next token as their value (allow negative numbers like -1)
              consumedIndices.add(i + 1);
              if (optDef?.type === 'number') {
                parsedFlags[key] = Number(next);
              } else {
                parsedFlags[key] = next;
              }
              i++;
            } else if (isBooleanFlag && (next === 'true' || next === 'false')) {
              // Explicit boolean value token
              consumedIndices.add(i + 1);
              parsedFlags[key] = next !== 'false';
              i++;
            } else {
              parsedFlags[key] = true;
            }
          } else if (subArgs[i].startsWith('-') && subArgs[i].length === 2 && /[a-zA-Z]/.test(subArgs[i][1])) {
            consumedIndices.add(i);
            const shortKey = subArgs[i][1];
            const optDef = subCmd.options?.find((o) => o.short === shortKey);
            if (optDef) {
              const key = optDef.name;
              const next = subArgs[i + 1];
              const isBooleanFlag = optDef.type === 'boolean';
              if (next && (!next.startsWith('-') || /^-\d/.test(next)) && !isBooleanFlag) {
                consumedIndices.add(i + 1);
                parsedFlags[key] = optDef.type === 'number' ? Number(next) : next;
                i++;
              } else if (isBooleanFlag && (next === 'true' || next === 'false')) {
                consumedIndices.add(i + 1);
                parsedFlags[key] = next !== 'false';
                i++;
              } else {
                parsedFlags[key] = true;
              }
            }
          }
        }
        const fakeCtx: CommandContext = {
          args: subArgs.filter((_, i) => !consumedIndices.has(i)),
          flags: parsedFlags,
          cwd: ctx.cwd,
          interactive: false,
        };

        const cmdResult = await subCmd.action(fakeCtx);
        const succeeded = cmdResult?.success !== false;
        results.push({ command: cmdStr, success: succeeded, error: succeeded ? undefined : 'Command returned failure' });
        if (!succeeded && ctx.flags.bail) break;
      } catch (e) {
        const err = e instanceof Error ? e.message : String(e);
        results.push({ command: cmdStr, success: false, error: err });
        output.printWarning(`Batch error in "${cmdStr}": ${err}`);
        if (ctx.flags.bail) break;
      }
    }

    const failed = results.filter((r) => !r.success).length;
    output.printInfo(`Batch: ${results.length - failed}/${results.length} succeeded`);
    return { success: failed === 0, data: { results } };
  },
};

const addinitscriptCommand: Command = {
  name: 'addinitscript',
  description: 'Add script to run before page navigation. Usage: monomind browse addinitscript "window.x=1"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const script = ctx.args[0] as string;
    if (!script) throw new Error('Usage: monomind browse addinitscript "<js>"');
    const id = await browser.addInitScript(client, sessionId, script);
    output.printSuccess(`Init script added: ${id}`);
    return { success: true, data: { identifier: id } };
  },
};

const removeinitscriptCommand: Command = {
  name: 'removeinitscript',
  description: 'Remove a previously added init script. Usage: monomind browse removeinitscript <id>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const id = ctx.args[0] as string;
    if (!id) throw new Error('Usage: monomind browse removeinitscript <identifier>');
    await browser.removeInitScript(client, sessionId, id);
    output.printSuccess(`Init script removed: ${id}`);
    return { success: true };
  },
};

const connectCommand: Command = {
  name: 'connect',
  description: 'Connect to existing Chrome instance. Usage: monomind browse connect [--port 9222] [--target <id>]',
  options: [
    { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
    { name: 'target', type: 'string', description: 'Target ID to attach to' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const port = (ctx.flags.port as number) ?? 9222;
    const browser = await getBrowser();

    if (_client) {
      const prevSid = _sessionId;
      const prevClient = _client;
      if (browser.getHarStatus(prevSid).recording) {
        try { await browser.stopHarRecording(prevClient, prevSid); } catch { /* ignore */ }
      }
      if (browser.getTraceStatus(prevSid)) {
        try { await browser.stopTrace(prevClient, prevSid); } catch { /* ignore */ }
      }
      if (browser.isProfilingActive(prevSid)) {
        try { await browser.stopCpuProfile(prevClient, prevSid); } catch { /* ignore */ }
      }
      browser.teardownRouteInterception(prevSid);
      browser.stopRequestCapture(prevSid);
      browser.teardownDialogHandling(prevSid);
      browser.teardownConsoleCapture(prevSid);
      prevClient.close();
      _client = null;
      _sessionId = '';
      _targetId = '';
      _refs = new Map();
    }

    const conn = await browser.connectToTarget(port, ctx.flags.target as string | undefined);
    _client = conn.client;
    _sessionId = conn.sessionId;
    _targetId = conn.target.id;
    _port = port;
    _refs = new Map();
    const url = await browser.getCurrentUrl(_client, _sessionId);
    const title = await browser.getCurrentTitle(_client, _sessionId);
    output.printSuccess(`Connected: ${title} (${url})`);
    return { success: true, data: { targetId: _targetId, url, title } };
  },
};

const recordCommand: Command = {
  name: 'record',
  description: 'Screen recording. Usage: monomind browse record start|stop|status [path]',
  options: [
    { name: 'format', type: 'string', description: 'jpeg|png', default: 'jpeg' },
    { name: 'quality', type: 'number', description: 'Quality 0-100', default: 80 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse record start|stop|status');

    switch (action) {
      case 'start':
        await browser.startRecording(client, sessionId, {
          format: ctx.flags.format as 'jpeg' | 'png',
          quality: ctx.flags.quality as number,
        });
        output.printSuccess('Recording started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopRecording(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Recording saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'status': {
        const status = browser.getRecordingStatus(sessionId);
        if (ctx.flags.json) print(JSON.stringify({ data: status }));
        else print(`Recording: ${status.recording} | Frames: ${status.frames}`);
        return { success: true, data: status };
      }
      default:
        throw new Error('Usage: monomind browse record start|stop|status [path]');
    }
  },
};

const traceCommand: Command = {
  name: 'trace',
  description: 'CDP performance trace. Usage: monomind browse trace start|stop [path]',
  options: [
    { name: 'screenshots', type: 'boolean', description: 'Include screenshots', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse trace start|stop [path]');

    switch (action) {
      case 'start':
        await browser.startTrace(client, sessionId, { screenshots: ctx.flags.screenshots as boolean });
        output.printSuccess('Trace started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopTrace(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Trace saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'status':
        print(browser.getTraceStatus(sessionId) ? 'Tracing active' : 'Not tracing');
        return { success: true };
      default:
        throw new Error('Usage: monomind browse trace start|stop|status [path]');
    }
  },
};

const profilerCommand: Command = {
  name: 'profiler',
  description: 'CPU profiler. Usage: monomind browse profiler start|stop|heap [path]',
  options: [
    { name: 'interval', type: 'number', description: 'Sampling interval µs', default: 1000 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse profiler start|stop|heap [path]');

    switch (action) {
      case 'start':
        await browser.startCpuProfile(client, sessionId, { samplingInterval: ctx.flags.interval as number });
        output.printSuccess('CPU profiler started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopCpuProfile(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Profile saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'heap': {
        const path = await browser.startHeapSnapshot(client, sessionId, ctx.args[1] as string);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`Heap snapshot saved: ${path}`);
        return { success: true, data: { path } };
      }
      default:
        throw new Error('Usage: monomind browse profiler start|stop|heap [path]');
    }
  },
};

const vitalsCommand: Command = {
  name: 'vitals',
  description: 'Collect Core Web Vitals. Usage: monomind browse vitals [--wait 2000]',
  options: [
    { name: 'wait', type: 'number', description: 'Wait ms for observers', default: 2000 },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const vitals = await browser.collectVitals(client, sessionId, ctx.flags.wait as number);
    if (ctx.flags.json) {
      print(JSON.stringify({ data: vitals }));
    } else {
      print(browser.formatVitals(vitals));
    }
    return { success: true, data: vitals };
  },
};

const harCommand: Command = {
  name: 'har',
  description: 'HAR network recording. Usage: monomind browse har start|stop|status [path]',
  options: [
    { name: 'bodies', type: 'boolean', description: 'Capture response bodies', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;
    if (!action) throw new Error('Usage: monomind browse har start|stop|status [path]');

    switch (action) {
      case 'start':
        await browser.startHarRecording(client, sessionId);
        output.printSuccess('HAR recording started');
        return { success: true };
      case 'stop': {
        const path = await browser.stopHarRecording(client, sessionId, ctx.args[1] as string, ctx.flags.bodies as boolean);
        if (ctx.flags.json) print(JSON.stringify({ data: { path } }));
        else output.printSuccess(`HAR saved: ${path}`);
        return { success: true, data: { path } };
      }
      case 'status': {
        const status = browser.getHarStatus(sessionId);
        if (ctx.flags.json) print(JSON.stringify({ data: status }));
        else print(`Recording: ${status.recording} | Requests: ${status.requestCount}`);
        return { success: true, data: status };
      }
      default:
        throw new Error('Usage: monomind browse har start|stop|status [path]');
    }
  },
};

const resizeCommand: Command = {
  name: 'resize',
  description: 'Resize browser window. Usage: monomind browse resize <width> <height>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(_port);
    const browser = await getBrowser();
    const width = parseInt(ctx.args[0] as string, 10);
    const height = parseInt(ctx.args[1] as string, 10);
    if (isNaN(width) || isNaN(height)) throw new Error('Usage: monomind browse resize <width> <height>');
    await browser.setViewport(client, sessionId, width, height);
    output.printSuccess(`Resized to ${width}x${height}`);
    return { success: true, data: { width, height } };
  },
};

// ---------------------------------------------------------------------------
// Commander-to-internal adapter
// ---------------------------------------------------------------------------

/**
 * Wraps a commander.Command instance as an internal Command object so it can
 * participate in the browse command's subcommands array.  The adapter
 * reconstructs a raw argv string from the context that was parsed by the
 * internal CLI, then hands it off to commander's parseAsync.
 */
function wrapCommanderCommand(factory: () => import('commander').Command): Command {
  // Lazily instantiate so we don't pay import cost at startup
  let _cmd: import('commander').Command | null = null;
  const getCmd = () => {
    if (!_cmd) _cmd = factory();
    return _cmd;
  };

  const cmd = getCmd();
  const subcommandDefs: Command[] = (cmd.commands as import('commander').Command[]).map((sub) => ({
    name: sub.name(),
    description: sub.description(),
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      // Rebuild argv: node <cmd> <sub> [positional args] [--flag [value] ...]
      const argv = ['node', cmd.name(), sub.name(), ...ctx.args];
      for (const [key, val] of Object.entries(ctx.flags)) {
        if (key === '_') continue;
        if (typeof val === 'boolean') {
          if (val) argv.push(`--${key}`);
        } else if (val !== undefined && val !== null) {
          argv.push(`--${key}`, String(val));
        }
      }
      // Re-use the same commander instance to keep state (e.g. option defaults)
      await getCmd().parseAsync(argv, { from: 'user' });
      return { success: true };
    },
  }));

  return {
    name: cmd.name(),
    description: cmd.description(),
    subcommands: subcommandDefs,
    action: async (ctx: CommandContext): Promise<CommandResult> => {
      // No subcommand provided — show commander help
      const argv = ['node', cmd.name(), ...ctx.args];
      for (const [key, val] of Object.entries(ctx.flags)) {
        if (key === '_') continue;
        if (typeof val === 'boolean') {
          if (val) argv.push(`--${key}`);
        } else if (val !== undefined && val !== null) {
          argv.push(`--${key}`, String(val));
        }
      }
      await getCmd().parseAsync(argv, { from: 'user' });
      return { success: true };
    },
  };
}

const workflowSubcommand: Command = wrapCommanderCommand(createWorkflowCommand);
const actionSubcommand: Command = wrapCommanderCommand(createActionCommand);
const platformSubcommand: Command = wrapCommanderCommand(createPlatformCommand);

// ---------------------------------------------------------------------------
// Root browse command
// ---------------------------------------------------------------------------

const browseCommand: Command = {
  name: 'browse',
  description: 'Native browser automation via Chrome DevTools Protocol',
  subcommands: [
    openCommand,
    snapshotCommand,
    clickCommand,
    dblclickCommand,
    fillCommand,
    typeCommand,
    pressCommand,
    keyboardCommand,
    keydownCommand,
    keyupCommand,
    hoverCommand,
    focusCommand,
    selectCommand,
    checkCommand,
    uncheckCommand,
    scrollIntoViewCommand,
    dragCommand,
    uploadCommand,
    mouseCommand,
    clipboardCommand,
    waitCommand,
    screenshotCommand,
    getCommand,
    scrollCommand,
    navigateCommand,
    setCommand,
    stateCommand,
    networkCommand,
    evalCommand,
    dialogCommand,
    frameCommand,
    tabCommand,
    consoleLogCommand,
    errorsCommand,
    storageCommand,
    cookiesCommand,
    pdfCommand,
    isCommand,
    findCommand,
    highlightCommand,
    pushstateCommand,
    batchCommand,
    addinitscriptCommand,
    removeinitscriptCommand,
    connectCommand,
    recordCommand,
    traceCommand,
    profilerCommand,
    vitalsCommand,
    harCommand,
    resizeCommand,
    closeCommand,
    workflowSubcommand,
    actionSubcommand,
    platformSubcommand,
  ],
  options: [
    { name: 'port', short: 'p', type: 'number', description: 'CDP debug port', default: 9222 },
    { name: 'session', short: 's', type: 'string', description: 'Named session to use' },
  ],
  examples: [
    { command: 'monomind browse open https://example.com', description: 'Open a URL' },
    { command: 'monomind browse snapshot -i', description: 'Interactive-only snapshot (93% token reduction)' },
    { command: 'monomind browse click @e3', description: 'Click element by ref' },
    { command: 'monomind browse fill @e1 "user@example.com"', description: 'Fill an input' },
    { command: 'monomind browse press Enter', description: 'Press Enter key' },
    { command: 'monomind browse wait --url "**/dashboard"', description: 'Wait for URL pattern' },
    { command: 'monomind browse wait --text "Success"', description: 'Wait for text' },
    { command: 'monomind browse wait --load networkidle', description: 'Wait for network idle' },
    { command: 'monomind browse screenshot ./output.png', description: 'Take screenshot' },
    { command: 'monomind browse get url', description: 'Get current URL' },
    { command: 'monomind browse scroll down', description: 'Scroll down 300px' },
    { command: 'monomind browse set viewport 375 812', description: 'Set mobile viewport' },
    { command: 'monomind browse state save my-session', description: 'Save session state' },
    { command: 'monomind browse navigate back', description: 'Navigate back' },
    { command: 'monomind browse eval "document.title"', description: 'Evaluate JavaScript' },
    { command: 'monomind browse network route --pattern "https://api.*" --abort', description: 'Abort API calls' },
    { command: 'monomind browse close', description: 'Close browser session' },
  ],
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    output.printInfo('Native browser automation via Chrome DevTools Protocol.');
    output.printInfo('');
    output.printInfo('Usage: monomind browse <subcommand> [options]');
    output.printInfo('');
    output.printInfo('Subcommands:');
    output.printInfo('  open           Open a URL');
    output.printInfo('  snapshot       Capture accessibility snapshot with refs');
    output.printInfo('  click          Click an element by ref');
    output.printInfo('  dblclick       Double-click an element');
    output.printInfo('  fill           Fill an input (clears first)');
    output.printInfo('  type           Type into element (appends)');
    output.printInfo('  press          Press a keyboard key');
    output.printInfo('  keyboard       Insert text directly');
    output.printInfo('  keydown        Hold a key down');
    output.printInfo('  keyup          Release a held key');
    output.printInfo('  hover          Hover over element');
    output.printInfo('  focus          Focus an element');
    output.printInfo('  select         Select a dropdown option');
    output.printInfo('  check          Check a checkbox');
    output.printInfo('  uncheck        Uncheck a checkbox');
    output.printInfo('  scrollintoview Scroll element into view');
    output.printInfo('  drag           Drag element to another element');
    output.printInfo('  upload         Upload file(s) to file input');
    output.printInfo('  mouse          Fine-grained mouse control');
    output.printInfo('  clipboard      Read/write clipboard');
    output.printInfo('  wait           Wait for a condition');
    output.printInfo('  screenshot     Take a screenshot');
    output.printInfo('  get            Get page info (url, title, text, html)');
    output.printInfo('  scroll         Scroll the page');
    output.printInfo('  navigate       Navigate history (back/forward/reload)');
    output.printInfo('  set            Configure viewport, device, user agent');
    output.printInfo('  state          Save/load/list session state');
    output.printInfo('  network        Network interception and cookies');
    output.printInfo('  eval           Evaluate JavaScript');
    output.printInfo('  dialog         Handle browser dialogs');
    output.printInfo('  frame          Switch to iframe');
    output.printInfo('  tab            Tab management');
    output.printInfo('  console        View captured console messages');
    output.printInfo('  errors         View page JS errors');
    output.printInfo('  storage        localStorage/sessionStorage management');
    output.printInfo('  cookies        Cookie management');
    output.printInfo('  pdf            Save page as PDF');
    output.printInfo('  is             Check element state (visible/enabled/checked)');
    output.printInfo('  find           Find elements by semantic locators');
    output.printInfo('  highlight      Highlight an element visually');
    output.printInfo('  pushstate      SPA navigation via pushState');
    output.printInfo('  batch          Execute multiple commands');
    output.printInfo('  addinitscript  Add script to run before page navigation');
    output.printInfo('  removeinitscript Remove a previously added init script');
    output.printInfo('  close          Close the browser session');
    return { success: true };
  },
};

export default browseCommand;
