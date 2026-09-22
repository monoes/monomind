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
  adoptLegacySession,
  detectAttentionNeeded,
  ensureConnected,
  getBrowser,
  launchSessionBrowser,
  pinnedPort,
  resolveLiveSession,
  session,
  switchToHeaded,
} from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const openCommand: Command = {
  name: 'open',
  description: 'Open a URL in the browser. Usage: monomind browse open <url>',
  options: [
    {
      name: 'port',
      short: 'p',
      type: 'number',
      description:
        'Attach to (or launch on) this CDP port. Default: a free port of this session’s own',
    },
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

    // No --port means "start a session of my own on a free port" (#318) —
    // never "join whatever is on 9222", which is what made two uncoordinated
    // `open` calls race for one browser and one profile directory.
    const port = pinnedPort(ctx.flags);
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

    // Starts this session's own browser (and records it) unless --port named
    // one to attach to — see the session rule in session.ts.
    session.port = await launchSessionBrowser(browser, { port, headless: !forceHeaded });
    const conn = await browser.connectToTarget(session.port);
    session.client = conn.client;
    session.sessionId = conn.sessionId;
    session.targetId = conn.target.id;
    session.refs = new Map();
    // A snapshot taken before this navigation is no longer valid for the new
    // page — drop the persisted ref cache so a stale process's weak
    // time-based check can't resurrect it before the next explicit snapshot.
    await browser.clearRefCache(session.port);

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
        await switchToHeaded(currentUrl, session.port);
        await browser.openUrl(session.client!, session.sessionId, currentUrl);
        output.printSuccess(
          `Resumed headless after ${attentionType === 'captcha' ? 'CAPTCHA' : 'login'}`,
        );
      }
    }

    const finalUrl = await browser.getCurrentUrl(session.client!, session.sessionId);
    const title = await browser.getCurrentTitle(session.client!, session.sessionId);

    // The port is part of the result, not decoration: it is this session's
    // handle, and the only way a concurrent caller can pin it from another
    // process (`--port N`) instead of resolving "the newest live session".
    output.printSuccess(`Opened: ${title} (${finalUrl}) [port ${session.port}]`);
    return { success: true, data: { url: finalUrl, title, port: session.port } };
  },
};

export const closeCommand: Command = {
  name: 'close',
  description:
    'Close a browser session. Usage: monomind browse close [--port <port>] (default: the newest live session here)',
  options: [
    {
      name: 'port',
      short: 'p',
      type: 'number',
      description: 'Close the session on this CDP port instead of the newest live one',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
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
      // Terminate the browser this process launched, not just our socket to
      // it: with a session of its own on a free port (#318), a Chrome left
      // behind here is one nothing else knows how to find. A browser we
      // merely attached to (`connect`) is the user's — never killed.
      const record = await browser.loadSessionRecord(session.port);
      if (record?.launched !== false) {
        try {
          await browser.closeBrowser(client, session.port);
        } catch {
          /* best-effort — the record cleanup below still runs */
        }
      }
      client.close();
      session.client = null;
      session.sessionId = '';
      session.parentSessionId = '';
      session.targetId = '';
      session.refs = new Map();
      // This session is gone — forget its record and stale refs so later
      // invocations don't chase a dead endpoint (or the wrong elements).
      // Other sessions' records are left alone.
      await browser.removeSessionRecord(session.port);
      await browser.clearRefCache(session.port);
      output.printSuccess(`Browser session closed (port ${session.port})`);
    } else {
      // Each CLI invocation is a fresh process, so `close` almost always
      // lands here. The session record is the real handle: `--port` names
      // one, otherwise it is the newest session whose browser still answers
      // (strict:false — a dead one is cleaned up, not raised as an error).
      // If monobrowse LAUNCHED that browser (open), gracefully Browser.close
      // it — otherwise every open→close cycle leaks a headless Chrome. If we
      // merely ATTACHED to it (connect, launched:false), never kill it: it's
      // the user's own browser. Either way, forget that one session.
      const browser = await getBrowser();
      const pinned = pinnedPort(ctx.flags);
      const persisted = pinned
        ? ((await browser.loadSessionRecord(pinned)) ??
          (await adoptLegacySession(browser, { port: pinned })) ?? {
            port: pinned,
            launched: true,
          })
        : await resolveLiveSession(browser, { strict: false });
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
      if (persisted) {
        await browser.removeSessionRecord(persisted.port);
        await browser.clearRefCache(persisted.port);
      }
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
    // Record the session like `open` does — without this, the NEXT CLI
    // process (each command is a fresh process) has nothing to resolve and
    // launches a browser of its own instead of reusing this session.
    // launched:false marks this browser as someone else's — close must never
    // kill it, and a dead endpoint must not be silently relaunched.
    await browser.saveSessionRecord(port, { launched: false });
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
