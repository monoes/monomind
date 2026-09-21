/**
 * The browser's own data and event surfaces — localStorage/sessionStorage,
 * cookies, the clipboard, dialogs, and the captured console/error logs.
 */

import { output } from './output.js';
import { ensureConnected, getBrowser, print, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const clipboardCommand: Command = {
  name: 'clipboard',
  description: 'Clipboard operations. Usage: monomind browse clipboard read|write|copy|paste',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
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

export const dialogCommand: Command = {
  name: 'dialog',
  description: 'Handle browser dialogs. Usage: monomind browse dialog accept|dismiss|status',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
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

export const consoleLogCommand: Command = {
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
      browser.clearConsoleMessages(session.sessionId);
      output.printSuccess('Console cleared');
      return { success: true };
    }
    const allMsgs = browser.getConsoleMessages(session.sessionId);
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

export const errorsCommand: Command = {
  name: 'errors',
  description: 'View page errors (uncaught JS exceptions). Usage: monomind browse errors [--clear]',
  options: [
    { name: 'clear', type: 'boolean', description: 'Clear errors', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const browser = await getBrowser();
    if (ctx.flags.clear) {
      browser.clearPageErrors(session.sessionId);
      output.printSuccess('Errors cleared');
      return { success: true };
    }
    const errs = browser.getPageErrors(session.sessionId);
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

export const storageCommand: Command = {
  name: 'storage',
  description:
    'localStorage/sessionStorage management. Usage: monomind browse storage local|session [key] [--set val] [--clear]',
  options: [
    { name: 'set', type: 'string', description: 'Value to set for key' },
    { name: 'clear', type: 'boolean', description: 'Clear all storage', default: false },
    { name: 'remove', type: 'boolean', description: 'Remove a specific key', default: false },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
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
      if (isLocal)
        await browser.setLocalStorageKey(client, sessionId, key, ctx.flags.set as string);
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

export const cookiesCommand: Command = {
  name: 'cookies',
  description: 'Cookie management. Usage: monomind browse cookies [list|set|clear]',
  options: [
    { name: 'name', type: 'string', description: 'Cookie name' },
    { name: 'value', type: 'string', description: 'Cookie value' },
    { name: 'domain', type: 'string', description: 'Cookie domain' },
    { name: 'curl', type: 'string', description: 'Import cookies from cURL dump file' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
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
        await browser.setCookies(client, sessionId, [
          {
            name,
            value,
            domain: ctx.flags.domain as string,
          },
        ]);
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
