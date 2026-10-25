// Split out of browser.ts (file-size sweep). Pure move: no behaviour change.

import { fetchBrowserWebSocketUrl } from './browser-discovery.js';
import { launchedPids, launchedUserDataDirs, ownedUserDataDirPorts } from './browser-state.js';
import { CdpClient, fetchTargets } from './cdp.js';
import { removeOwnedProfileDir } from './profile-dir.js';
import {
  listSessionRecords,
  loadSessionRecord,
  removeSessionRecord,
  type SessionRecord,
} from './ref-cache.js';

const BROWSER_CLOSE_TIMEOUT_MS = 3000;
// How long closeBrowser() waits for the process to actually disappear before
// forcing it, and again after forcing. Bounded so a wedged Chrome cannot hang
// a caller indefinitely.
const PROCESS_EXIT_TIMEOUT_MS = 5000;
const PROCESS_EXIT_POLL_MS = 50;
// A cross-process persisted PID older than this is not trusted for the
// SIGKILL fallback in closeBrowser() — see the call site for why.
const PERSISTED_PID_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// A browser WE launched that has had no targets for longer than this is
// reaped at the next launch/attach — see reapIdleLaunchedBrowser().
const IDLE_REAP_AFTER_MS = 30 * 60 * 1000;
const REAP_CONNECT_TIMEOUT_MS = 3000;

/**
 * Cleanly terminate a Chrome/Chromium instance we launched on `port`.
 * Sends the `Browser.close` CDP command (the correct graceful shutdown —
 * closes all tabs and exits the process cleanly) over `client`'s connection.
 * If that command fails, times out, or the connection is already gone,
 * falls back to killing the tracked PID directly so a headed/interactive
 * browser window (e.g. one spawned for a login/CAPTCHA flow) never lingers
 * as a visible, authenticated, still-debuggable orphan process.
 *
 * On the graceful path this resolves only once the process is actually gone,
 * or after force-killing it when it outlasts PROCESS_EXIT_TIMEOUT_MS. Chrome
 * acknowledges `Browser.close` well before it exits, and this used to return
 * on the ack with an unref'd 1s timer as the only force-kill — so it resolved
 * while Chrome was still running and holding its port and its profile's
 * singleton lock, and if the caller's process exited first the kill never
 * happened at all. Callers reasonably read a resolved close() as "that
 * browser is gone"; on the graceful path it now means that.
 *
 * A profile directory monobrowse created for that browser (the default temp
 * profile, or a CLI session's — never a caller-supplied one) is deleted once
 * the process is gone, on both paths (#395). In a fresh process the dir and
 * its ownership come from the persisted session record.
 */
export async function closeBrowser(client: CdpClient | null, port: number): Promise<void> {
  let gracefullyClosed = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  if (client) {
    try {
      await Promise.race([
        client.send('Browser.close', {}),
        // Deliberately NOT unref'd, for the same reason waitForProcessExit()'s
        // poll below is not. This timer is the only thing that settles the race
        // when Chrome's socket dies without ever acknowledging the close, and
        // closeBrowser() is actively awaited by callers. An unref'd timer does
        // not hold the event loop open, so Node would consider the loop drained
        // and exit — status 0, before the caller's verdict was ever printed.
        // Cleared in the finally so a close that IS acknowledged does not pin
        // the loop for the rest of BROWSER_CLOSE_TIMEOUT_MS.
        new Promise<never>((_, reject) => {
          closeTimer = setTimeout(
            () => reject(new Error('Browser.close timed out')),
            BROWSER_CLOSE_TIMEOUT_MS,
          );
        }),
      ]);
      gracefullyClosed = true;
    } catch {
      // fall through to PID-kill fallback below
    } finally {
      clearTimeout(closeTimer);
    }
  }

  let pid = launchedPids.get(port);
  let profileDir = ownedUserDataDirPorts.has(port) ? launchedUserDataDirs.get(port) : undefined;
  if (pid === undefined) {
    // Fresh process (each CLI invocation is its own node process — see
    // module header) — launchedPids is per-process and empty here even
    // though a prior `open` in a DIFFERENT process launched this Chrome.
    // Fall back to the PID that process persisted via saveSessionRecord().
    try {
      const persisted = await loadSessionRecord(port);
      if (persisted?.launched && persisted.pid) {
        // Bound how far we trust a cross-process PID: if the Chrome we
        // launched died outside this flow (OOM-killed, host slept, etc.)
        // without its session record ever being cleared, the OS can recycle
        // that PID for an unrelated process. There is no cmdline/start-time
        // check available portably, so a coarse age bound is the practical
        // guard — a PID persisted more than a day ago is far more likely to
        // be stale/reused than to still be the same live Chrome.
        const age = persisted.savedAt !== undefined ? Date.now() - persisted.savedAt : undefined;
        if (age === undefined || age <= PERSISTED_PID_MAX_AGE_MS) {
          pid = persisted.pid;
          if (persisted.ownsUserDataDir) profileDir = persisted.userDataDir;
        }
      }
    } catch {
      // best-effort — fall through to "nothing to kill" below
    }
  }
  if (pid === undefined) return; // not a process we launched, or too stale to trust — nothing to kill
  launchedPids.delete(port);
  ownedUserDataDirPorts.delete(port);

  // Liveness-check before every SIGKILL (not just the safety-net path below)
  // — process.kill(pid, 0) throws ESRCH if the PID is no longer running,
  // which also catches the case where the PID has already been recycled by
  // an unrelated process that happens to have exited too.
  if (!gracefullyClosed) {
    try {
      process.kill(pid, 0);
      process.kill(pid, 'SIGKILL');
    } catch {
      /* already exited, or never was — nothing to do */
    }
  } else if (!(await waitForProcessExit(pid))) {
    // Browser.close was acknowledged — wait for the process to actually go
    // away, then force-kill as a safety net in case it hung.
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      /* raced us to exit — expected */
    }
  }

  // Waits (bounded) for the killed process to be gone before deleting.
  if (profileDir) await removeOwnedProfileDir(profileDir, { pid });
}

/** Poll until `pid` is gone or PROCESS_EXIT_TIMEOUT_MS elapses. Returns
 *  whether it exited. `process.kill(pid, 0)` throws once the process is no
 *  longer there, on Windows as well as POSIX.
 *
 *  This timer is deliberately NOT unref'd. closeBrowser() awaits this poll
 *  as part of its own return value — a caller that awaits closeBrowser() is
 *  actively blocked on it, not doing other work in the background. Once
 *  Chrome's CDP websocket closes (which happens right around here, as part
 *  of it shutting down), nothing else may be left holding the event loop
 *  open; an unref'd timer at that point never fires because Node considers
 *  the loop drained and exits without running it, leaving this promise (and
 *  closeBrowser()'s) pending forever — reproduced locally by closing a real
 *  launched browser with nothing else scheduled. Bounded by
 *  PROCESS_EXIT_TIMEOUT_MS (5s) either way, so keeping it ref'd only ever
 *  costs a caller a few seconds, never a hang. */
async function waitForProcessExit(pid: number): Promise<boolean> {
  const deadline = Date.now() + PROCESS_EXIT_TIMEOUT_MS;
  for (;;) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => {
      setTimeout(resolve, PROCESS_EXIT_POLL_MS);
    });
  }
}

/**
 * Give back the CDP port of a browser we launched that nothing is using any
 * more. A launched Chrome is deliberately detached and unref'd so it outlives
 * the command that spawned it and later commands can reattach — but nothing
 * reaped it afterwards, so an abandoned session kept listening on its port
 * (9222 by convention, which other local tools want) indefinitely. A foreign
 * CDP server *answers* there rather than refusing the connection, so those
 * tools retry the wrong port and report misleading errors instead of moving on.
 *
 * Nothing long-lived exists to run this on a timer — every CLI command is its
 * own short-lived process — so it runs at the next launch/attach instead
 * (see launchBrowser). A browser is reaped only when ALL of these hold:
 *   - the persisted session says WE launched it — `connect` records
 *     launched:false for a browser that belongs to the user, never touched;
 *   - that session is older than IDLE_REAP_AFTER_MS;
 *   - the CDP endpoint still answers and reports ZERO targets. An open tab,
 *     or a client attached to one (Chrome drops webSocketDebuggerUrl from an
 *     attached target but still lists it), means the session is live and
 *     reattach-across-commands must keep working.
 *
 * Shutdown goes through closeBrowser() on the browser-level websocket — the
 * only connection left once every target is gone — so a recycled PID can
 * never be signaled by mistake: graceful `Browser.close` reaches whatever is
 * actually listening on that port, at any age, and the persisted PID is only
 * ever used for closeBrowser's own age-bounded force-kill.
 *
 * Never throws: a failed reap must not stop a launch. Returns the reaped
 * port, or null when there was nothing to reap. Sessions are per-port
 * (#318), so every recorded one is considered, not just the newest.
 */
export async function reapIdleLaunchedBrowser(): Promise<number | null> {
  let reaped: number | null = null;
  for (const session of await listSessionRecords().catch(() => [])) {
    const port = await reapSession(session);
    reaped ??= port;
  }
  return reaped;
}

async function reapSession(session: SessionRecord): Promise<number | null> {
  try {
    if (!session.launched || session.savedAt === undefined) return null;
    if (Date.now() - session.savedAt < IDLE_REAP_AFTER_MS) return null;

    const wsUrl = await fetchBrowserWebSocketUrl(session.port);
    if (!wsUrl) return null;
    if ((await fetchTargets(session.port)).length > 0) return null;

    const client = new CdpClient();
    let reapTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      // CdpClient.connect() has no timeout of its own — a socket that never
      // opens (and never errors) would hang the launch this reap is running
      // inside of, which is strictly worse than leaving the port squatted.
      // Not unref'd (see closeBrowser): a socket that never opens and never
      // errors leaves this timer as the only thing that can settle the race,
      // and the reap is awaited inside launch/attach. Cleared in the finally
      // below so a connect that succeeds does not pin the event loop.
      await Promise.race([
        client.connect(wsUrl),
        new Promise<never>((_, reject) => {
          reapTimer = setTimeout(
            () => reject(new Error('Reap: CDP connect timed out')),
            REAP_CONNECT_TIMEOUT_MS,
          );
        }),
      ]);
      await closeBrowser(client, session.port);
    } finally {
      clearTimeout(reapTimer);
      try {
        client.close();
      } catch {
        /* already gone */
      }
    }
    launchedPids.delete(session.port);
    launchedUserDataDirs.delete(session.port);
    await removeSessionRecord(session.port);
    return session.port;
  } catch {
    return null;
  }
}
