// Split out of browser.ts (file-size sweep). Pure move: no behaviour change.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  browserIdOf,
  chromeIdentity,
  fetchBrowserWebSocketUrl,
  isChromeIdentity,
  isPortOpen,
  isTcpPortOpen,
  readDevToolsActivePort,
  resolveChrome,
} from './browser-discovery.js';
import { reapIdleLaunchedBrowser } from './browser-lifecycle.js';
import { launchedPids, launchedUserDataDirs, ownedUserDataDirPorts } from './browser-state.js';
import { DEFAULT_CDP_PORT } from './cdp-port.js';
import {
  launchProfileDirPath,
  removeOwnedProfileDir,
  sweepStaleProfileDirs,
} from './profile-dir.js';
import type { BrowserConfig } from './types.js';

const LAUNCH_TIMEOUT = 10_000;
const POLL_INTERVAL = 200;

/** Ports scanned when the requested one is occupied by a non-Chrome process
 *  (e.g. another local tool that happens to reuse Chrome's conventional CDP
 *  default, 9222 — mirrors the auto-increment convention this monorepo's own
 *  dashboard server uses in bindServer/server.mjs). Only occupied-by-a-
 *  DIFFERENT-process is worked around; an already-attachable Chrome on the
 *  requested port is still returned as-is (existing "attach, don't relaunch"
 *  behavior). */
const LAUNCH_PORT_SCAN_TRIES = 10;

/** Chrome's process exited before its CDP endpoint opened. */
class ChromeExitedEarlyError extends Error {}

export async function launchBrowser(config: BrowserConfig = {}): Promise<number> {
  const rawPort = config.port ?? DEFAULT_CDP_PORT;
  // Port 0 means "let Chrome bind a free port and tell us which" — see
  // launchOnFreePort. Otherwise validate port is in a safe range for
  // localhost CDP debugging.
  if (rawPort === 0) {
    if (!config.userDataDir) {
      throw new Error(
        'port 0 requires a dedicated userDataDir (Chrome reports the port it bound inside it).',
      );
    }
  } else if (!Number.isInteger(rawPort) || rawPort < 1024 || rawPort > 65535) {
    throw new Error(`Invalid port: ${rawPort}. Must be 0 or an integer between 1024 and 65535.`);
  }

  // Every launch/attach is this tool's only chance to notice that a previous
  // session abandoned a browser on a CDP port and never gave it back — there
  // is no daemon to do it on a timer. Bounded and non-throwing; a stale
  // instance on the port we are about to use is freed before we probe it.
  await reapIdleLaunchedBrowser();
  // Same reasoning for temp profile dirs (#395): a process that crashed or
  // was killed never deleted the one its browser used. Only dead, idle,
  // unused dirs of our own naming go — see sweepStaleProfileDirs.
  await sweepStaleProfileDirs();

  if (rawPort === 0) return launchOnFreePort(config, 0);

  // strictPort: fail fast on the exact requested port, matching the old
  // behavior (Vite has the same escape hatch for the same reason) — for
  // callers that treat the error as a signal ("this port is taken by
  // something else, bail") rather than consuming the returned port.
  if (config.strictPort) {
    if (await isTcpPortOpen(rawPort)) {
      if (await isChromeIdentity(rawPort)) return rawPort;
      throw new Error(
        `Port ${rawPort} is occupied by a process that does not identify as Chrome/Chromium. ` +
          `Refusing to attach — pass a different port or free port ${rawPort}.`,
      );
    }
    return launchOnFreePort(config, rawPort);
  }

  const candidates: number[] = [];
  for (let i = 0; i < LAUNCH_PORT_SCAN_TRIES && rawPort + i <= 65535; i++)
    candidates.push(rawPort + i);

  // See the catch below: one early Chrome exit on a candidate nobody holds
  // afterwards is read as a lost port race, not a broken Chrome.
  let toleratedEarlyExit: ChromeExitedEarlyError | null = null;
  for (const candidate of candidates) {
    // TCP-level check for "is anything at all listening" — isPortOpen()
    // does a full CDP /json fetch, which returns false BOTH for a genuinely
    // free port and for one occupied by a non-CDP process (that ambiguity is
    // exactly what the post-spawn isTcpPortOpen fallback below exists to
    // resolve, the hard way, after a 10s launch timeout). Checking the raw
    // socket first tells free and occupied apart up front, so the scan can
    // skip an occupied candidate instead of trying to spawn Chrome on top of
    // it and only discovering the conflict after a timeout.
    if (await isTcpPortOpen(candidate)) {
      // Attach-if-already-Chrome only applies to the EXACT requested port —
      // the original, deliberate, single-port risk ("don't silently take
      // over an unrelated real browser that happens to be on this port").
      // Scanning past an occupied default must not let that same shortcut
      // attach to a DIFFERENT Chrome instance the caller never named;
      // forward candidates are launch-only (skip if anything is there,
      // Chrome or not).
      if (candidate === rawPort && (await isChromeIdentity(candidate))) return candidate;
      // Occupied (by anything — not just non-Chrome, per the note above) —
      // try the next candidate instead of failing outright, same as a
      // normal EADDRINUSE retry would.
      continue;
    }
    try {
      return await launchOnFreePort(config, candidate);
    } catch (err) {
      const isLastCandidate = candidate === candidates[candidates.length - 1];
      // isTcpPortOpen() above is a connect() probe, not an atomic claim: two
      // concurrent launchBrowser() calls with no explicit --port can both
      // observe the same candidate as free and both spawn Chrome on it
      // before either binds. One wins; the other's Chrome exits before its
      // CDP endpoint opens ("Chrome exited before the CDP endpoint opened
      // ... code=21"). Something is listening on the candidate NOW that
      // was not a moment ago — a losing race, not a broken Chrome install —
      // so try the next candidate exactly like an already-occupied one,
      // instead of failing the whole launch outright. A candidate that
      // fails with nothing now listening is usually a real launch failure
      // (bad executable, sandbox refusal, etc.) that the next candidate would
      // only repeat, so it is surfaced as-is.
      if (!isLastCandidate && (await isTcpPortOpen(candidate))) continue;
      // Usually, but not always (#491): two launches that call listen() on
      // the same port at the same instant can BOTH lose it on Linux — each
      // socket is marked LISTEN before the kernel checks the port for
      // conflicts, so each sees the other and gets EADDRINUSE. Both Chromes
      // exit early and the port is free again, which is indistinguishable
      // from a Chrome that cannot start. Move on once; a Chrome that really
      // cannot start exits the same way on the next candidate, and the first
      // of the two identical failures is surfaced.
      if (err instanceof ChromeExitedEarlyError) {
        if (!isLastCandidate && !toleratedEarlyExit) {
          toleratedEarlyExit = err;
          continue;
        }
        throw toleratedEarlyExit ?? err;
      }
      throw err;
    }
  }
  throw new Error(
    `Ports ${candidates[0]}-${candidates[candidates.length - 1]} are all occupied and port ${candidates[0]} ` +
      `isn't a Chrome/Chromium instance to attach to. Pass a different --port.`,
  );
}

/**
 * Spawn Chrome and wait for its CDP endpoint.
 *
 * With a fixed `port`, "our Chrome is up" is inferred from *some* Chrome
 * answering on 127.0.0.1:<port> — which is not necessarily ours. When the port
 * is already bound on 127.0.0.1 (a concurrent launch picked the same "free"
 * port between its probe and Chrome's bind), Chrome does not fail: it logs
 * `bind() failed: Address already in use` and listens on [::1]:<port>
 * instead. The poll then accepts the OTHER launcher's browser, both callers
 * drive one Chrome, and whichever closes first kills the other's connections
 * ("CDP connection closed") while this launch's own Chrome is orphaned.
 *
 * `port: 0` removes the race instead of narrowing it: Chrome asks the kernel
 * for a free port at bind time — atomic, nothing to collide on — and writes
 * the port it got to DevToolsActivePort in its own (caller-dedicated) profile
 * directory, which is proof the endpoint is the process we spawned.
 *
 * A fixed port needs its own proof, since Chrome writes DevToolsActivePort
 * only for port 0. Once listening, Chrome prints `DevTools listening on
 * ws://…/devtools/browser/<id>` to stderr, and `<id>` is unique to that
 * browser process, the same one `/json/version` reports. An endpoint is
 * adopted only when it reports the id our own child printed. Without that
 * check, a launch whose Chrome was still booting found a concurrent
 * launch's Chrome on the shared port and returned it, recording its own
 * doomed pid there. It also covers Chrome's [::1] fallback described above.
 */
async function launchOnFreePort(config: BrowserConfig, port: number): Promise<number> {
  const chromePath = await resolveChrome(config.executablePath);
  // Unique per launch, not just per port and pid: two concurrent launches
  // that both probe the same candidate port as free (the race this function
  // exists to survive — see the retry-on-collision caller above) would
  // otherwise share one profile directory (lock files, preferences, the
  // DevToolsActivePort file itself) — including two launches from the same
  // process, where a pid suffix alone is identical.
  const userDataDir = config.userDataDir ?? launchProfileDirPath(port, randomUUID().slice(0, 8));
  // A dir we created is deleted once its browser is gone (#395); a
  // caller-supplied one only when the caller says it made it for us.
  const ownsUserDataDir = config.userDataDir === undefined || config.ownsUserDataDir === true;
  const activePortFile = join(userDataDir, 'DevToolsActivePort');
  // A reused profile dir may hold a previous run's file naming a port some
  // other process now owns.
  if (port === 0) rmSync(activePortFile, { force: true });

  const defaultArgs = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-client-side-phishing-detection',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--safebrowsing-disable-auto-update',
    '--password-store=basic',
    '--use-mock-keychain',
  ];

  if (config.headless !== false) {
    defaultArgs.push('--headless=new');
  }

  // Chrome's setuid sandbox cannot initialise on most CI runners and
  // containers, so the process dies during startup and the CDP endpoint never
  // opens. The launch below then burns its whole timeout before reporting a
  // generic failure, which reads as a hang rather than "Chrome could not
  // start". Disabling the sandbox is the standard remedy and is scoped to CI
  // so a real user's browser keeps it. --disable-dev-shm-usage goes with it:
  // a container's default /dev/shm is 64MB, which Chrome exhausts and then
  // crashes the same way.
  if (process.env.CI) {
    defaultArgs.push('--no-sandbox', '--disable-dev-shm-usage');
  }

  // Cap caller-supplied args to prevent memory exhaustion via huge argument arrays
  const callerArgs = (config.args ?? []).slice(0, 50);
  const args = [...defaultArgs, ...callerArgs];
  const child = spawn(chromePath, args, {
    detached: true,
    // stderr carries the fixed-port ownership proof (see above). The pipe is
    // closed as soon as this launch settles, so a Chrome that outlives us
    // never blocks writing to it.
    stdio: port === 0 ? 'ignore' : ['ignore', 'ignore', 'pipe'],
  });
  let announcedBrowserId: string | null = null;
  if (child.stderr) {
    let stderrTail = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      if (announcedBrowserId) return;
      stderrTail = (stderrTail + chunk).slice(-4096);
      announcedBrowserId = browserIdOf(
        /DevTools listening on (ws:\/\/\S+)\r?\n/.exec(stderrTail)?.[1],
      );
    });
    child.stderr.on('error', () => {
      /* closed under us — nothing to read */
    });
  }

  // Without this, a spawn failure (e.g. EACCES/ENOENT — chromePath exists per
  // findChrome()'s existsSync check but isn't actually executable, or is
  // removed between the check and exec) fires Node's 'error' event on the
  // next tick. With no listener, Node throws it as an uncaught exception and
  // the whole process goes down — which strands this function's promise
  // forever pending rather than rejecting it (issue #314: node:test reports
  // that as "cancelledByParent" / "still pending" because nothing here ever
  // got the chance to settle it). Recording the failure and having the poll
  // loop below notice it turns that crash into a normal rejection. 'exit'
  // covers the twin case: Chrome execs fine but the process itself dies
  // immediately (missing shared libraries, a container's sandbox refusing
  // it, etc.) — that fires 'exit', not 'error', and without this the poll
  // loop would just burn its whole timeout probing a port nothing will ever
  // open on.
  let earlyFailure: Error | null = null;
  child.on('error', (err) => {
    earlyFailure ??= new Error(`Chrome failed to start on port ${port}: ${err.message}`);
  });
  child.on('exit', (code, signal) => {
    earlyFailure ??= new ChromeExitedEarlyError(
      `Chrome exited before the CDP endpoint opened on port ${port} ` +
        `(code=${code ?? 'null'}, signal=${signal ?? 'null'})`,
    );
  });

  child.unref();
  const track = (boundPort: number) => {
    if (!child.pid) return;
    launchedPids.set(boundPort, child.pid);
    launchedUserDataDirs.set(boundPort, userDataDir);
    if (ownsUserDataDir) ownedUserDataDirPorts.add(boundPort);
    else ownedUserDataDirPorts.delete(boundPort);
  };
  // Tracked only once Chrome is CONFIRMED up on `boundPort`, not right after
  // spawn(). For port !== 0 this used to track(port) unconditionally the
  // moment the child was spawned, before knowing whether it would actually
  // win the port — when a racing launchBrowser() call retries a candidate
  // that a concurrent process also spawned Chrome on (see the retry loop in
  // launchBrowser), BOTH child processes called track() for the SAME
  // candidate, and whichever call's spawn happened to run last clobbered the
  // map entry with its own pid — including the LOSING, about-to-exit
  // process's pid overwriting the real winner's, corrupting the very map
  // closeBrowser()'s kill fallback depends on.

  // A refused or timed-out launch is not tracked under any port, so no
  // closeBrowser() could ever reach it — stop it rather than leave it
  // running.
  const killUntracked = () => {
    try {
      if (child.pid) process.kill(child.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  };

  // Our own Chrome, not just some Chrome, is serving `boundPort`. For port 0
  // the port came from our own profile's DevToolsActivePort, so it is.
  const isOwnEndpoint = async (boundPort: number): Promise<boolean> => {
    if (port === 0) return true;
    if (!announcedBrowserId) return false;
    const wsUrl = await fetchBrowserWebSocketUrl(boundPort).catch(() => null);
    return browserIdOf(wsUrl ?? undefined) === announcedBrowserId;
  };

  const launchTimeout = config.launchTimeoutMs ?? LAUNCH_TIMEOUT;
  const deadline = Date.now() + launchTimeout;
  let launched = false;
  try {
    while (Date.now() < deadline) {
      if (earlyFailure) throw earlyFailure;
      await sleep(POLL_INTERVAL);
      if (earlyFailure) throw earlyFailure;
      const boundPort = port === 0 ? readDevToolsActivePort(activePortFile) : port;
      if (boundPort !== null && (await isPortOpen(boundPort))) {
        const identity = await chromeIdentity(boundPort);
        if (identity === 'chrome') {
          if (await isOwnEndpoint(boundPort)) {
            track(boundPort);
            launched = true;
            return boundPort;
          }
          // Some Chrome answers on the port, but not the one we started: a
          // concurrent launch's, or ours before its stderr line arrived. Our
          // child exiting (it lost the bind) or the deadline decides.
          continue;
        }
        // A Chrome that has only just opened its endpoint, on a loaded
        // machine, can answer /json/list (no timeout) yet miss the identity
        // check's 1 s timeout on /json/version. That says nothing about who is
        // listening — keep polling rather than refuse our own Chrome.
        if (identity === 'unknown') continue;
        killUntracked();
        throw new Error(
          `Port ${boundPort} is occupied by a CDP-speaking process that does not identify as Chrome/Chromium. ` +
            `Refusing to attach — pass a different port or free port ${boundPort}.`,
        );
      }
    }

    if (earlyFailure) throw earlyFailure;
    killUntracked();

    if (port === 0) {
      throw new Error(
        `Chrome did not report a CDP port in ${activePortFile} within ${launchTimeout}ms`,
      );
    }

    // Timed out waiting for our Chrome to come up on the port. Distinguish
    // "another Chrome holds it", "nothing is listening" (real launch failure)
    // and "something non-CDP is squatting the port" (confusing generic
    // timeout otherwise).
    if (await isChromeIdentity(port)) {
      throw new Error(
        `Port ${port} is held by a Chrome/Chromium this launch did not start (a concurrent launch took it).`,
      );
    }
    if (await isTcpPortOpen(port)) {
      throw new Error(
        `Port ${port} is occupied by a non-Chrome process (TCP connection succeeds but no CDP response within ${launchTimeout}ms). ` +
          `Free the port or pass a different one.`,
      );
    }

    throw new Error(`Chrome failed to start on port ${port} within ${launchTimeout}ms`);
  } finally {
    child.stderr?.destroy();
    // A failed launch (lost port race, refusal, timeout) is never tracked,
    // so no close will ever clean its profile — and the port-scan retry in
    // launchBrowser can make several of these per call.
    if (!launched && ownsUserDataDir) await removeOwnedProfileDir(userDataDir, { pid: child.pid });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
