/**
 * Browsing context — which page, frame or window the session currently acts
 * on, and saving or restoring that context.
 *
 * `frame`/`tab`/`window` retarget the session (an OOPIF gets its own CDP
 * sessionId, which is why the parent is saved for `frame main`). `state`
 * persists cookies and storage so a later run can pick the context back up.
 */

import { output } from './output.js';
import { ensureConnected, getBrowser, print, session } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const stateCommand: Command = {
  name: 'state',
  description:
    'Manage browser session state. Usage: monomind browse state save|load|list|rename|clean [name]',
  options: [
    {
      name: 'older-than',
      type: 'number',
      description: 'For state clean: remove sessions older than N days',
    },
  ],
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
        const { client, sessionId } = await ensureConnected(session.port);
        const target = ctx.args[1] as string;
        if (!target) throw new Error('Usage: monomind browse state save <name-or-file>');
        const url = await browser.getCurrentUrl(client, sessionId);
        const title = await browser.getCurrentTitle(client, sessionId);
        if (target.endsWith('.json')) {
          await browser.saveStateFile(client, sessionId, session.targetId, target, url, title);
          output.printSuccess(`State saved to ${target}`);
        } else {
          const path = await browser.saveSession(
            client,
            sessionId,
            session.targetId,
            target,
            url,
            title,
          );
          output.printSuccess(`Session "${target}" saved to ${path}`);
        }
        return { success: true };
      }
      case 'load': {
        const { client, sessionId } = await ensureConnected(session.port);
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
        const { client: c, sessionId: sid } = await ensureConnected(session.port);
        const url = await browser.getCurrentUrl(c, sid);
        const title = await browser.getCurrentTitle(c, sid);
        const cookies = await browser.getCookies(c, sid);
        const ls = await browser.getAllLocalStorage(c, sid);
        const info = {
          url,
          title,
          cookies: cookies.length,
          localStorage: Object.keys(ls).length,
          refs: session.refs.size,
        };
        print(JSON.stringify(info, null, 2));
        return { success: true, data: info };
      }
      case 'clear': {
        const { client: c, sessionId: sid } = await ensureConnected(session.port);
        await browser.clearCookies(c, sid);
        await browser.clearLocalStorage(c, sid);
        await browser.clearSessionStorage(c, sid);
        session.refs = new Map();
        await browser.clearRefCache(session.port);
        output.printSuccess('Browser state cleared (cookies, localStorage, sessionStorage, refs)');
        return { success: true };
      }
      case 'rename': {
        const oldName = ctx.args[1] as string;
        const newName = ctx.args[2] as string;
        if (!oldName || !newName)
          throw new Error('Usage: monomind browse state rename <old-name> <new-name>');
        const sessions = await browser.listSessions();
        if (!sessions.includes(oldName)) throw new Error(`Session not found: ${oldName}`);
        // W1: validate newName to prevent path traversal
        const { basename: basenameFn } = await import('node:path');
        const safeName = basenameFn(newName);
        if (safeName !== newName || safeName.startsWith('.') || safeName.includes('/')) {
          throw new Error(
            'Invalid session name — must not contain path separators or start with "."',
          );
        }
        const {
          unlink: unlinkRename,
          readFile,
          writeFile,
          mkdir: mkdirRename,
        } = await import('node:fs/promises');
        const { join: joinR } = await import('node:path');
        const { homedir } = await import('node:os');
        const sessionDir = joinR(homedir(), '.monomind', 'browser-sessions');
        const oldPath = joinR(sessionDir, `${oldName}.json`);
        const newPath = joinR(sessionDir, `${newName}.json`);
        const data = JSON.parse(await readFile(oldPath, 'utf8'));
        data.name = newName;
        await mkdirRename(sessionDir, { recursive: true });
        await writeFile(newPath, JSON.stringify(data, null, 2), 'utf8');
        await unlinkRename(oldPath).catch(() => {}); // C1: delete old file (not rename to /dev/null)
        output.printSuccess(`Session renamed: ${oldName} → ${newName}`);
        return { success: true };
      }
      case 'clean': {
        const days = (ctx.flags['older-than'] as number) ?? 7;
        const { unlink, stat } = await import('node:fs/promises');
        const { join: joinC } = await import('node:path');
        const { homedir: homedirC } = await import('node:os');
        const sessionDir = joinC(homedirC(), '.monomind', 'browser-sessions');
        const sessions = await browser.listSessions();
        const cutoff = Date.now() - days * 86400 * 1000;
        let removed = 0;
        for (const name of sessions) {
          const p = joinC(sessionDir, `${name}.json`);
          const s = await stat(p).catch(() => null);
          if (s && s.mtimeMs < cutoff) {
            await unlink(p).catch(() => {});
            removed++;
          }
        }
        output.printSuccess(`Cleaned ${removed} session(s) older than ${days} days`);
        return { success: true, data: { removed } };
      }
      default:
        throw new Error(`Unknown action: ${action}. Use: save|load|list|show|clear|rename|clean`);
    }
  },
};

export const frameCommand: Command = {
  name: 'frame',
  description:
    'Switch to iframe or back to main. Usage: monomind browse frame "#frame-id" | frame main',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const target = ctx.args[0] as string;
    if (!target) throw new Error('Usage: monomind browse frame <selector>|main');

    if (target === 'main') {
      if (session.parentSessionId) {
        // Detach from the OOPIF session (best-effort — it may already be gone)
        await client
          .send('Target.detachFromTarget', { sessionId: session.sessionId })
          .catch(() => {});
        session.sessionId = session.parentSessionId;
        session.parentSessionId = '';
      }
      output.printSuccess('Switched to main frame');
    } else {
      const frameResult = await browser.switchToFrame(client, sessionId, target);
      if (frameResult.sessionId) {
        // Save the parent session so `frame main` can restore it
        session.parentSessionId = session.sessionId;
        session.sessionId = frameResult.sessionId;
        // Enable CDP domains on the iframe's session so subsequent commands work
        await browser.enableSessionDomains(client, session.sessionId);
      }
      output.printSuccess(`Switched to frame: ${frameResult.url ?? target}`);
    }
    return { success: true };
  },
};

export const tabCommand: Command = {
  name: 'tab',
  description: 'Tab management. Usage: monomind browse tab list|new|close [url]',
  options: [{ name: 'label', type: 'string', description: 'Label for new tab' }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    switch (action ?? 'list') {
      case 'list': {
        const tabs = await browser.listTabs(session.port);
        for (const t of tabs) print(`  ${t.id}: ${t.title} (${t.url})`);
        return { success: true, data: { tabs } };
      }
      case 'new': {
        const url = ctx.args[1] as string | undefined;
        const tab = await browser.newTab(session.port, url);
        output.printSuccess(`New tab: ${tab.id} ${url ?? ''}`);
        return { success: true, data: { tab } };
      }
      case 'close': {
        const tabId = ctx.args[1] as string;
        if (!tabId) throw new Error('Usage: monomind browse tab close <tabId>');
        if (tabId === session.targetId) {
          const sid = session.sessionId;
          // Stop profiling before closing the tab so CDP commands still reach the live session
          if (browser.getHarStatus(sid).recording) {
            try {
              await browser.stopHarRecording(client, sid);
            } catch {
              /* ignore */
            }
          }
          if (browser.getTraceStatus(sid)) {
            try {
              await browser.stopTrace(client, sid);
            } catch {
              /* ignore */
            }
          }
          if (browser.isProfilingActive(sid)) {
            try {
              await browser.stopCpuProfile(client, sid);
            } catch {
              /* ignore */
            }
          }
          browser.teardownRouteInterception(sid);
          browser.stopRequestCapture(sid);
          browser.teardownDialogHandling(sid);
          browser.teardownConsoleCapture(sid);
          await browser.closeTab(client, sessionId, tabId);
          client.close();
          session.client = null;
          session.sessionId = '';
          session.parentSessionId = '';
          session.targetId = '';
          session.refs = new Map();
        } else {
          await browser.closeTab(client, sessionId, tabId);
        }
        output.printSuccess(`Closed tab: ${tabId}`);
        break;
      }
      default: {
        // Attach to new tab FIRST — only tear down old session if that succeeds
        const newSid = await browser.activateTab(client, sessionId, action);
        const oldSid = session.sessionId;
        if (browser.getHarStatus(oldSid).recording) {
          try {
            await browser.stopHarRecording(client, oldSid);
          } catch {
            /* ignore */
          }
        }
        if (browser.getTraceStatus(oldSid)) {
          try {
            await browser.stopTrace(client, oldSid);
          } catch {
            /* ignore */
          }
        }
        if (browser.isProfilingActive(oldSid)) {
          try {
            await browser.stopCpuProfile(client, oldSid);
          } catch {
            /* ignore */
          }
        }
        await browser.disableInterception(client, oldSid).catch(() => {});
        browser.stopRequestCapture(oldSid);
        browser.teardownDialogHandling(oldSid);
        browser.teardownConsoleCapture(oldSid);
        session.sessionId = newSid;
        session.targetId = action;
        session.refs = new Map();
        await browser.enableSessionDomains(client, session.sessionId);
        output.printSuccess(`Switched to tab: ${action}`);
      }
    }
    return { success: true };
  },
};

export const windowCommand: Command = {
  name: 'window',
  description: 'Browser window management. Usage: monomind browse window new [url]',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId: _sid } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const action = ctx.args[0] as string;

    if (!action || action === 'new') {
      // Create isolated browser context (incognito-like) with a fresh page
      const ctxResult = await client.send<{ browserContextId: string }>(
        'Target.createBrowserContext',
        {},
        undefined,
      );
      const browserContextId = ctxResult.browserContextId;
      const url = (ctx.args[1] as string) || 'about:blank';
      const targetResult = await client.send<{ targetId: string }>(
        'Target.createTarget',
        { url, browserContextId },
        undefined,
      );
      const targetId = targetResult.targetId;
      const attachResult = await client.send<{ sessionId: string }>(
        'Target.attachToTarget',
        { targetId, flatten: true },
        undefined,
      );
      const newSessionId = attachResult.sessionId;
      // W3: fully tear down old session before switching
      const oldSid = session.sessionId;
      if (browser.getHarStatus(oldSid).recording) {
        try {
          await browser.stopHarRecording(client, oldSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.getTraceStatus(oldSid)) {
        try {
          await browser.stopTrace(client, oldSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.isProfilingActive(oldSid)) {
        try {
          await browser.stopCpuProfile(client, oldSid);
        } catch {
          /* ignore */
        }
      }
      browser.teardownRouteInterception(oldSid);
      browser.stopRequestCapture(oldSid);
      browser.teardownDialogHandling(oldSid);
      browser.teardownConsoleCapture(oldSid);
      session.sessionId = newSessionId;
      session.targetId = targetId;
      session.refs = new Map();
      await browser.enableSessionDomains(client, session.sessionId);
      output.printSuccess(`Opened new window (isolated context): ${targetId} [${url}]`);
      return { success: true, data: { targetId, browserContextId, sessionId: newSessionId } };
    }

    throw new Error(`Unknown window action: ${action}. Use: new`);
  },
};
