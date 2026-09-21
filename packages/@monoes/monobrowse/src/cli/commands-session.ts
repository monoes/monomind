/**
 * Session lifecycle — starting a browser session, attaching to one someone
 * else started, and ending it.
 *
 * `open` launches (or reuses) headless Chrome and is the only command that can
 * escalate to a headed window for a login/CAPTCHA wall. `connect` attaches to
 * a browser the user already runs, which is why `close` treats the two
 * differently: it must never kill a Chrome it did not launch.
 */

import { output } from './output.js';
import {
  detectAttentionNeeded,
  ensureConnected,
  ensureSignalCleanupHandlers,
  getBrowser,
  session,
  switchToHeaded,
} from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const openCommand: Command = {
  name: 'open',
  description: 'Open a URL in the browser. Usage: monomind browse open <url>',
  options: [
    { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
    {
      name: 'headed',
      type: 'boolean',
      description: 'Force visible browser window',
      default: false,
    },
    { name: 'session', short: 's', type: 'string', description: 'Session name to restore' },
    { name: 'state', type: 'string', description: 'State file to load' },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const url = ctx.args[0] as string;
    if (!url) throw new Error('URL required. Usage: monomind browse open <url>');

    const port = (ctx.flags.port as number) ?? 9222;
    const forceHeaded = ctx.flags.headed as boolean;
    const browser = await getBrowser();

    if (session.client) {
      const prevSid = session.sessionId;
      const prevClient = session.client;
      if (browser.getHarStatus(prevSid).recording) {
        try {
          await browser.stopHarRecording(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.getTraceStatus(prevSid)) {
        try {
          await browser.stopTrace(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.isProfilingActive(prevSid)) {
        try {
          await browser.stopCpuProfile(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      browser.teardownRouteInterception(prevSid);
      browser.stopRequestCapture(prevSid);
      browser.teardownDialogHandling(prevSid);
      browser.teardownConsoleCapture(prevSid);
      prevClient.close();
      session.client = null;
      session.sessionId = '';
      session.parentSessionId = '';
      session.targetId = '';
      session.refs = new Map();
    }

    session.port = await browser.launchBrowser({ port, headless: !forceHeaded });
    // Persist the active port so subsequent CLI invocations (each a fresh
    // process) default to attaching here instead of hardcoded 9222. Also
    // persist the launched PID/userDataDir so a later process's closeBrowser
    // can still kill this Chrome even though launchedPids (browser.ts) is
    // per-process and empty there.
    //
    // launchBrowser() can either LAUNCH a fresh Chrome or ATTACH to one
    // already listening on the requested port (see its own "attach if
    // already Chrome" comment) — it returns only a port number, with no
    // signal telling this caller which happened. getLaunchedPid(session.port) is
    // undefined on the attach path (this process never spawned anything).
    // Bug fixed here: unconditionally saving {pid: undefined, ...} on
    // attach used to CLOBBER a real PID a previous `open` had already
    // persisted for this exact port, destroying the only way a later
    // process's closeBrowser() PID-kill fallback could ever find it.
    const freshPid = browser.getLaunchedPid(session.port);
    const freshUserDataDir = browser.getLaunchedUserDataDir(session.port);
    if (freshPid !== undefined) {
      await browser.saveActivePort(session.port, { pid: freshPid, userDataDir: freshUserDataDir });
    } else {
      // Attach path: preserve whatever PID/userDataDir was already on file
      // for this port (most likely from the process that originally
      // launched it) instead of overwriting with undefined.
      const existing = await browser.loadActivePortInfo();
      const preserved = existing && existing.port === session.port ? existing : undefined;
      await browser.saveActivePort(session.port, {
        pid: preserved?.pid,
        userDataDir: preserved?.userDataDir,
      });
    }
    ensureSignalCleanupHandlers();
    const conn = await browser.connectToTarget(session.port);
    session.client = conn.client;
    session.sessionId = conn.sessionId;
    session.targetId = conn.target.id;
    session.refs = new Map();
    // A snapshot taken before this navigation is no longer valid for the new
    // page — drop the persisted ref cache so a stale process's weak
    // time-based check can't resurrect it before the next explicit snapshot.
    await browser.clearRefCache();

    if (ctx.flags.state && ctx.flags.session) {
      output.printWarning('Both --state and --session provided; --state takes precedence');
    }
    if (ctx.flags.state) {
      await browser.loadStateFile(session.client, session.sessionId, ctx.flags.state as string);
    } else if (ctx.flags.session) {
      await browser.loadSession(session.client, session.sessionId, ctx.flags.session as string);
    }

    await browser.openUrl(session.client, session.sessionId, url);
    const currentUrl = await browser.getCurrentUrl(session.client, session.sessionId);

    // Auto-detect login/CAPTCHA walls and switch to headed if needed
    if (!forceHeaded) {
      const attentionType = await detectAttentionNeeded(
        session.client,
        session.sessionId,
        currentUrl,
      );
      if (attentionType) {
        output.printWarning(
          `${attentionType === 'captcha' ? 'CAPTCHA' : 'Login'} detected — switching to headed mode`,
        );
        await switchToHeaded(currentUrl, port);
        await browser.openUrl(session.client!, session.sessionId, currentUrl);
        output.printSuccess(
          `Resumed headless after ${attentionType === 'captcha' ? 'CAPTCHA' : 'login'}`,
        );
      }
    }

    const finalUrl = await browser.getCurrentUrl(session.client!, session.sessionId);
    const title = await browser.getCurrentTitle(session.client!, session.sessionId);

    output.printSuccess(`Opened: ${title} (${finalUrl})`);
    return { success: true, data: { url: finalUrl, title } };
  },
};

export const closeCommand: Command = {
  name: 'close',
  description: 'Close the active browser session',
  action: async (_ctx: CommandContext): Promise<CommandResult> => {
    if (session.client) {
      const browser = await getBrowser();
      const sid = session.sessionId;
      const client = session.client;
      // Tear down per-session Maps and listeners before closing
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
      client.close();
      session.client = null;
      session.sessionId = '';
      session.parentSessionId = '';
      session.targetId = '';
      session.refs = new Map();
      // Session is gone — forget the persisted port and stale refs so later
      // invocations don't chase a dead endpoint (or the wrong elements).
      await browser.clearActivePort();
      await browser.clearRefCache();
      output.printSuccess('Browser session closed');
    } else {
      // Each CLI invocation is a fresh process, so `close` almost always
      // lands here. The persisted port file is the real session handle:
      // if monobrowse LAUNCHED that browser (open), gracefully Browser.close
      // it — otherwise every open→close cycle leaks a headless Chrome. If we
      // merely ATTACHED to it (connect, launched:false), never kill it: it's
      // the user's own browser. Either way, forget the port and refs.
      const browser = await getBrowser();
      const persisted = await browser.loadActivePortInfo();
      if (persisted?.launched) {
        try {
          const conn = await browser.connectToTarget(persisted.port);
          try {
            await browser.closeBrowser(conn.client, persisted.port);
          } finally {
            // Always drop our websocket — a hung Browser.close must not keep
            // this CLI process's event loop alive.
            try {
              conn.client.close();
            } catch {
              /* already gone */
            }
          }
          // closeBrowser has no PID fallback in a fresh process (launchedPids
          // is per-process) — re-probe so we report what actually happened.
          // Poll briefly: Browser.close is acknowledged before the process
          // actually exits, so a single immediate probe false-alarms.
          let stillUp = true;
          const probeDeadline = Date.now() + 3000;
          while (stillUp && Date.now() < probeDeadline) {
            try {
              await fetch(`http://127.0.0.1:${persisted.port}/json/version`, {
                signal: AbortSignal.timeout(800),
              });
              await new Promise((r) => setTimeout(r, 300));
            } catch {
              stillUp = false;
            }
          }
          if (stillUp)
            output.printWarning(
              `Browser on port ${persisted.port} did not exit — kill it manually if needed`,
            );
          else output.printSuccess(`Closed browser on port ${persisted.port}`);
        } catch {
          output.printInfo(`No browser answering on port ${persisted.port} — nothing to close`);
        }
      } else {
        output.printInfo(
          persisted
            ? `Detached from browser on port ${persisted.port} (attached via connect — left running)`
            : 'No active browser session',
        );
      }
      await browser.clearActivePort();
      await browser.clearRefCache();
    }
    return { success: true };
  },
};

export const connectCommand: Command = {
  name: 'connect',
  description:
    'Connect to existing Chrome instance; later commands reuse this session (note: `open` without --port still launches on its own default). Usage: monomind browse connect [--port 9222] [--target <id>] [--auto-connect]',
  options: [
    { name: 'port', short: 'p', type: 'number', description: 'CDP port', default: 9222 },
    { name: 'target', type: 'string', description: 'Target ID to attach to' },
    {
      name: 'auto-connect',
      type: 'boolean',
      description: 'Auto-discover running Chrome on ports 9222 and 9229',
      default: false,
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    let port = (ctx.flags.port as number) ?? 9222;

    if (ctx.flags['auto-connect']) {
      const probePorts = [9222, 9229];
      let found = false;
      for (const p of probePorts) {
        try {
          const r = await fetch(`http://127.0.0.1:${p}/json/version`);
          if (r.ok) {
            port = p;
            found = true;
            break;
          }
        } catch {
          /* port not open */
        }
      }
      if (!found)
        throw new Error(
          'No running Chrome instance found. Launch Chrome with --remote-debugging-port or use --port.',
        );
    }

    const browser = await getBrowser();

    if (session.client) {
      const prevSid = session.sessionId;
      const prevClient = session.client;
      if (browser.getHarStatus(prevSid).recording) {
        try {
          await browser.stopHarRecording(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.getTraceStatus(prevSid)) {
        try {
          await browser.stopTrace(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      if (browser.isProfilingActive(prevSid)) {
        try {
          await browser.stopCpuProfile(prevClient, prevSid);
        } catch {
          /* ignore */
        }
      }
      browser.teardownRouteInterception(prevSid);
      browser.stopRequestCapture(prevSid);
      browser.teardownDialogHandling(prevSid);
      browser.teardownConsoleCapture(prevSid);
      prevClient.close();
      session.client = null;
      session.sessionId = '';
      session.parentSessionId = '';
      session.targetId = '';
      session.refs = new Map();
    }

    const conn = await browser.connectToTarget(port, ctx.flags.target as string | undefined);
    session.client = conn.client;
    session.sessionId = conn.sessionId;
    session.targetId = conn.target.id;
    session.port = port;
    session.refs = new Map();
    // Persist the port like `open` does — without this, the NEXT CLI process
    // (each command is a fresh process) resolves the hardcoded default and
    // tries to launch its own Chrome on 9222 instead of reusing this session.
    // launched:false marks this browser as someone else's — close must never
    // kill it, and a dead endpoint must not be silently relaunched.
    await browser.saveActivePort(port, { launched: false });
    const url = await browser.getCurrentUrl(session.client, session.sessionId);
    const title = await browser.getCurrentTitle(session.client, session.sessionId);
    output.printSuccess(`Connected: ${title} (${url})`);
    return { success: true, data: { targetId: session.targetId, url, title } };
  },
};

export const resizeCommand: Command = {
  name: 'resize',
  description: 'Resize browser window. Usage: monomind browse resize <width> <height>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const width = parseInt(ctx.args[0] as string, 10);
    const height = parseInt(ctx.args[1] as string, 10);
    if (Number.isNaN(width) || Number.isNaN(height))
      throw new Error('Usage: monomind browse resize <width> <height>');
    await browser.setViewport(client, sessionId, width, height);
    output.printSuccess(`Resized to ${width}x${height}`);
    return { success: true, data: { width, height } };
  },
};
