/**
 * Browse session runtime — the one live CDP session every browse subcommand
 * acts on, the helpers that establish and tear it down, and the small
 * flag/output helpers they all share.
 *
 * A CLI invocation is a single process with a single session, so the state is
 * module-level. It is a mutable record rather than separate bindings because
 * the subcommand modules that update it import it (see `session`).
 *
 * THE SESSION RULE (#318). A browse session is one Chrome plus the CDP port
 * it listens on, recorded per working directory in
 * `.monomind/monobrowse/sessions/<port>.json`:
 *
 *   - `open` with no `--port` STARTS its own session: Chrome binds a
 *     kernel-assigned free port in a profile directory of its own. It never
 *     joins an existing one, so two uncoordinated invocations can never land
 *     on the same port or profile. `open` reports the port it got.
 *   - `open`/`connect` WITH `--port N` keep the old behaviour exactly: attach
 *     to a Chrome already listening on N, otherwise launch there.
 *   - Any later command with no `--port` acts on the newest session in this
 *     directory whose browser still answers; every dead record it passes on
 *     the way is dropped (self-heal). With none left it starts a session of
 *     its own, exactly as `open` would.
 *   - Any later command with `--port N` acts on that session, which is how a
 *     concurrent caller pins the one `open` handed it.
 *   - `close` ends exactly the session it resolved — one browser, one record.
 *
 * Split out of commands.ts, which is now the command catalogue.
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CdpClient, ElementRef, SessionRecord } from '../index.js';
import { output } from './output.js';
import type { ParsedFlags } from './types.js';

/** `session.port` when no `--port` was given: resolve or start one instead. */
const UNPINNED = 0;

// Runtime state (single session per CLI process).
//
// One mutable record rather than separate module-level bindings: every
// subcommand module reads and writes the SAME session, and ESM import
// bindings are read-only for the importer, so the state has to live behind
// an object for a command in another file to be able to update it.
export const session: {
  client: CdpClient | null;
  sessionId: string;
  targetId: string;
  port: number;
  refs: Map<string, ElementRef>;
  /** Saved parent sessionId when inside an iframe — restored by `frame main`. */
  parentSessionId: string;
} = {
  client: null,
  sessionId: '',
  targetId: '',
  port: UNPINNED,
  refs: new Map(),
  parentSessionId: '',
};

/**
 * The session the caller pinned with `--port`, or undefined for "whichever
 * session this directory's store resolves to". Anything unusable — absent,
 * out of range, unparseable — reads as undefined.
 */
export function pinnedPort(flags: ParsedFlags): number | undefined {
  const raw = flags.port;
  const port = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : Number.NaN;
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
}

/**
 * Pin this process to the session named by `--port` before the subcommand
 * runs (see the wrapper in commands.ts), so every command that resolves its
 * session through `session.port` honours the selector.
 */
export function applySessionPortFlag(flags: ParsedFlags): void {
  // Only ever pins: a command with no --port must not reset the port of a
  // session this process already established (`batch "open …" "snapshot"`
  // runs both actions in one process, and the second must stay on the
  // session the first started).
  const pinned = pinnedPort(flags);
  if (pinned !== undefined) session.port = pinned;
}

export async function getBrowser() {
  return import('../index.js');
}

// Best-effort cleanup on Ctrl-C / kill so a launched Chrome doesn't linger as
// an orphan process when a command is interrupted mid-flight (e.g. during a
// long-running wait/eval that CdpClient.send()'s own timeout hasn't tripped
// yet).
//
// This module is imported for EVERY `monomind` CLI invocation (commands/
// index.ts statically imports browse.ts, which imports this file) — not just
// browse commands — so the handler is only *registered* once a browser
// session is actually launched here (see ensureSignalCleanupHandlers(),
// called from the `open` action below), not at module load. Registering
// unconditionally at import time would call process.exit() on Ctrl-C for
// every unrelated monomind command (e.g. a long-running `org run` daemon),
// pre-empting whatever other SIGINT/SIGTERM handling that process needs.
const SIGNAL_EXIT_CODES: Record<'SIGINT' | 'SIGTERM', number> = { SIGINT: 130, SIGTERM: 143 };
let _signalHandlersRegistered = false;
export function ensureSignalCleanupHandlers(): void {
  if (_signalHandlersRegistered) return;
  _signalHandlersRegistered = true;
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => {
      void (async () => {
        try {
          const browser = await getBrowser();
          if (session.client) {
            await browser.closeBrowser(session.client, session.port);
          } else {
            const pid = browser.getLaunchedPid(session.port);
            if (pid !== undefined) {
              try {
                process.kill(pid, 'SIGKILL');
              } catch {
                /* already exited */
              }
            }
          }
        } catch {
          // best-effort — never block process exit on cleanup failure
        }
      })().finally(() => process.exit(SIGNAL_EXIT_CODES[sig]));
    });
  }
}

// Each CLI invocation is a fresh process, so the session a previous `open`
// started only survives as its record on disk. Walk the recorded sessions
// newest-first and return the first whose browser still answers — that is
// "the" session for a command that did not pin one with `--port`.
//
// Records whose browser is gone are dropped as we pass them (self-heal): a
// crashed or manually-killed Chrome must not wedge every later command.
export async function resolveLiveSession(
  browser: Awaited<ReturnType<typeof getBrowser>>,
  opts: { strict?: boolean } = {},
): Promise<SessionRecord | null> {
  for (const record of await browser.listSessionRecords()) {
    if (await cdpAnswers(record.port)) return record;
    await browser.removeSessionRecord(record.port);
    await browser.clearRefCache(record.port);
    if (!record.launched && opts.strict !== false) {
      // connect-origin port: the browser belonged to someone else. Silently
      // launching our own headless Chrome on that port would squat the
      // user's debug port and swap which browser commands act on — fail
      // loudly instead. `close` passes strict:false; it has nothing to
      // attach to and just cleans up.
      throw new Error(
        `Connected browser on port ${record.port} is gone — re-run \`connect\` (or \`open\` to launch a fresh one).`,
      );
    }
  }
  return null;
}

async function cdpAnswers(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Start or attach to the browser this session drives, and record it.
 *
 * With a `port`, that is the caller's explicit `--port`: attach to a Chrome
 * already listening there, else launch there (unchanged behaviour). Without
 * one, Chrome binds a kernel-assigned free port in a profile directory of
 * this session's own — the allocation that makes two concurrent `open`
 * invocations independent (#318).
 */
export async function launchSessionBrowser(
  browser: Awaited<ReturnType<typeof getBrowser>>,
  opts: { port?: number; headless: boolean },
): Promise<number> {
  const port = opts.port
    ? await browser.launchBrowser({ port: opts.port, headless: opts.headless })
    : await browser.launchBrowser({
        port: 0,
        headless: opts.headless,
        // Chrome reports the port it bound inside this directory, so it must
        // belong to this session alone.
        userDataDir: join(tmpdir(), `monomind-browse-${process.pid}-${randomUUID().slice(0, 8)}`),
      });
  await recordSession(browser, port);
  ensureSignalCleanupHandlers();
  return port;
}

// Persist the session so later CLI invocations (each a fresh process) can
// find this browser, together with the launched PID/userDataDir so their
// closeBrowser can still kill it even though launchedPids (browser.ts) is
// per-process and empty there.
//
// launchBrowser() can either LAUNCH a fresh Chrome or ATTACH to one already
// listening on an explicitly requested port (see its own "attach if already
// Chrome" comment) — it returns only a port number, with no signal telling
// this caller which happened. getLaunchedPid(port) is undefined on the
// attach path (this process never spawned anything). Unconditionally saving
// {pid: undefined} on attach used to CLOBBER a real PID a previous `open`
// had persisted for this exact port, destroying the only way a later
// process's closeBrowser() PID-kill fallback could ever find it.
async function recordSession(
  browser: Awaited<ReturnType<typeof getBrowser>>,
  port: number,
): Promise<void> {
  const pid = browser.getLaunchedPid(port);
  if (pid !== undefined) {
    await browser.saveSessionRecord(port, {
      pid,
      userDataDir: browser.getLaunchedUserDataDir(port),
    });
    return;
  }
  const existing = await browser.loadSessionRecord(port);
  await browser.saveSessionRecord(port, {
    launched: existing?.launched,
    pid: existing?.pid,
    userDataDir: existing?.userDataDir,
  });
}

export async function ensureConnected(port: number, targetId?: string) {
  const browser = await getBrowser();
  if (!session.client?.isConnected()) {
    if (session.client && session.sessionId) {
      browser.teardownRouteInterception(session.sessionId);
      browser.stopRequestCapture(session.sessionId);
      browser.teardownDialogHandling(session.sessionId);
      browser.teardownConsoleCapture(session.sessionId);
      session.client.close();
    }
    // Pinned port, else the newest live session, else a session of our own —
    // a command run before any `open` still just works.
    const pinned = port > 0 ? port : ((await resolveLiveSession(browser))?.port ?? undefined);
    session.port = await launchSessionBrowser(browser, { port: pinned, headless: true });
    const conn = await browser.connectToTarget(session.port, targetId);
    session.client = conn.client;
    session.sessionId = conn.sessionId;
    session.targetId = conn.target.id;
    session.parentSessionId = '';
    session.refs = new Map();
    await hydrateRefsFromCache(browser, session.targetId, conn.target.url);
  }
  return { client: session.client!, sessionId: session.sessionId, targetId: session.targetId };
}

// Each CLI invocation is a fresh process, so the in-memory session.refs Map built by
// a prior `snapshot` command is gone by the time a later `find`/`click`/etc.
// command runs. Rehydrate it from the on-disk ref cache (written by
// captureSnapshot call sites below) so refs resolved by a previous process
// remain usable. Falls back silently to an empty Map if no cache exists.
//
// The cached `url` field (captured at snapshot time) is compared against the
// browser's CURRENT url (`currentUrl`, from the just-fetched target info).
// A stale `backendDOMNodeId` can still successfully resolve via
// DOM.getBoxModel even after a same-tab SPA navigation or DOM mutation
// changed what's actually at those coordinates — so a mismatch here means
// EVERY ref in the cache is potentially pointing at the wrong element. We
// hard-invalidate (skip hydration entirely, so any @eN lookup fails loudly
// via resolveRef's "not found" error) rather than the weaker 30s time-based
// staleness check below, which only warns.
export async function hydrateRefsFromCache(
  browser: Awaited<ReturnType<typeof getBrowser>>,
  targetId: string,
  currentUrl: string,
): Promise<void> {
  const cached = await browser.loadRefCache(session.port, targetId);
  if (!cached) return;
  if (currentUrl && cached.url && currentUrl !== cached.url) {
    output.printError(
      `Stale references — page has navigated (cache: ${cached.url} → current: ${currentUrl}). Re-run snapshot before using @eN refs.`,
    );
    return; // leave session.refs empty — do not attempt to resolve refs against a different page
  }
  session.refs = cached.refs;
  if (cached.stale) {
    output.printWarning(
      `AX ref cache is ${Math.round(cached.ageMs / 1000)}s old — page may have changed since the last snapshot; re-run snapshot if refs don't resolve as expected`,
    );
  }
}

// URL patterns that signal an unambiguous login/auth wall.
// Excludes 'auth', 'oauth', 'sso', 'saml' — their callback/ACS/token paths
// (/auth/callback, /sso/callback, /saml/acs) are completion endpoints, not walls.
// DOM detection (password field, CAPTCHA widgets) handles SSO/SAML login pages.
const ATTENTION_URL_RE =
  /\/(login|log-in|signin|sign-in|captcha|mfa|2fa|account\/login|accounts\/login|session\/new|users\/sign_in)(?:[/?#]|$)/i;

export async function detectAttentionNeeded(
  client: CdpClient,
  sessionId: string,
  url: string,
): Promise<'login' | 'captcha' | null> {
  if (ATTENTION_URL_RE.test(url)) return 'login';
  try {
    const hasPassword = await client
      .send<{ result: { value: boolean } }>(
        'Runtime.evaluate',
        {
          expression: '!!document.querySelector("input[type=password]")',
          returnByValue: true,
        },
        sessionId,
      )
      .then((r) => r.result?.value === true)
      .catch(() => false);
    if (hasPassword) return 'login';

    const hasCaptcha = await client
      .send<{ result: { value: boolean } }>(
        'Runtime.evaluate',
        {
          expression:
            '!!(document.querySelector("iframe[src*=recaptcha]") || document.querySelector("iframe[src*=hcaptcha]") || document.querySelector(".g-recaptcha") || document.querySelector(".h-captcha") || document.querySelector("[data-sitekey]"))',
          returnByValue: true,
        },
        sessionId,
      )
      .then((r) => r.result?.value === true)
      .catch(() => false);
    if (hasCaptcha) return 'captcha';
  } catch {
    /* ignore CDP errors */
  }
  return null;
}

export function waitForEnter(): Promise<void> {
  if (!process.stdin.isTTY) {
    // Non-interactive context (MCP server, piped input, CI) — cannot safely read stdin.
    // Auto-continue after a short grace period so automation isn't blocked.
    output.printWarning(
      'Non-interactive mode: auto-continuing in 30s. Switch to headed manually if needed.',
    );
    return new Promise((resolve) => setTimeout(resolve, 30_000));
  }
  return new Promise((resolve) => {
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = () => {
      process.stdin.pause();
      process.stdin.off('data', onData);
      resolve();
    };
    process.stdin.once('data', onData);
  });
}

export async function switchToHeaded(url: string, port: number): Promise<void> {
  const browser = await getBrowser();

  // Snapshot cookies from current headless session before closing
  let savedCookies: unknown[] = [];
  if (session.client && session.sessionId) {
    try {
      savedCookies = await browser.getCookies(session.client, session.sessionId);
    } catch {
      /* ignore */
    }
    browser.teardownRouteInterception(session.sessionId);
    browser.stopRequestCapture(session.sessionId);
    browser.teardownDialogHandling(session.sessionId);
    browser.teardownConsoleCapture(session.sessionId);
    session.client.close();
    session.client = null;
    session.sessionId = '';
    session.parentSessionId = '';
    session.targetId = '';
  }

  // Kernel-assigned free port and a profile of its own, so this temporary
  // headed window cannot collide with any other session (#318) — a
  // neighbouring port (port + 10) could well be another session's.
  let headedPort = 0;
  try {
    headedPort = await browser.launchBrowser({
      port: 0,
      headless: false,
      userDataDir: join(
        tmpdir(),
        `monomind-browse-headed-${process.pid}-${randomUUID().slice(0, 8)}`,
      ),
    });
  } catch (err) {
    // Headed launch failed (no display, locked down env). Restore headless and rethrow.
    session.port = await browser.launchBrowser({ port, headless: true });
    const fallback = await browser.connectToTarget(session.port);
    session.client = fallback.client;
    session.sessionId = fallback.sessionId;
    session.targetId = fallback.target.id;
    session.refs = new Map();
    throw new Error(
      `Cannot open headed browser: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const conn = await browser.connectToTarget(headedPort);
  session.client = conn.client;
  session.sessionId = conn.sessionId;
  session.targetId = conn.target.id;
  session.refs = new Map();

  if (savedCookies.length) {
    try {
      await browser.setCookies(
        session.client,
        session.sessionId,
        savedCookies as Parameters<typeof browser.setCookies>[2],
      );
    } catch {
      /* ignore */
    }
  }
  await browser.openUrl(session.client, session.sessionId, url);

  output.printInfo(
    'Browser window opened. Complete the required action (login / CAPTCHA), then press Enter to continue in headless mode...',
  );
  await waitForEnter();

  // Capture post-auth cookies
  const authCookies = await browser
    .getCookies(session.client, session.sessionId)
    .catch(() => [] as unknown[]);
  const authLocalStorage = await browser
    .getLocalStorage(session.client, session.sessionId)
    .catch(() => ({}) as Record<string, string>);

  // Close headed session — actually terminate the underlying Chrome process
  // (Browser.close CDP command, PID-kill fallback), not just our CDP client
  // connection, so the visible authenticated window doesn't linger forever.
  browser.teardownRouteInterception(session.sessionId);
  browser.stopRequestCapture(session.sessionId);
  browser.teardownDialogHandling(session.sessionId);
  browser.teardownConsoleCapture(session.sessionId);
  await browser.closeBrowser(session.client, headedPort);
  session.client.close();
  session.client = null;
  session.sessionId = '';
  session.parentSessionId = '';
  session.targetId = '';

  // Relaunch headless and restore session
  session.port = await browser.launchBrowser({ port, headless: true });
  const headlessConn = await browser.connectToTarget(session.port);
  session.client = headlessConn.client;
  session.sessionId = headlessConn.sessionId;
  session.targetId = headlessConn.target.id;
  session.refs = new Map();

  if (authCookies.length) {
    try {
      await browser.setCookies(
        session.client,
        session.sessionId,
        authCookies as Parameters<typeof browser.setCookies>[2],
      );
    } catch {
      /* ignore */
    }
  }
  if (authLocalStorage && Object.keys(authLocalStorage).length) {
    try {
      await browser.setLocalStorage(session.client, session.sessionId, authLocalStorage);
    } catch {
      /* ignore */
    }
  }
}

// Cap on printed output so a command cannot flood a terminal or an agent's
// context with a whole page. 0 disables truncation.
export const DEFAULT_EVAL_MAX_OUTPUT = 50_000;

export function truncateForOutput(text: string, maxOutput: number): string {
  if (!(maxOutput > 0) || text.length <= maxOutput) return text;
  return `${text.slice(0, maxOutput)}\n[... truncated at ${maxOutput} chars]`;
}

/**
 * Sanitize an image-format flag. The host CLI (monomind) defines a GLOBAL
 * --format flag for output shaping (text|json|table, default 'text') that
 * leaks into subcommand flags — so ctx.flags.format arrives as 'text' even
 * when the user never passed it, and Chrome rejects it with
 * "CDP error -32602: Invalid image format". Only trust values that are real
 * image formats; otherwise fall back to the subcommand's own default.
 */
export function imageFormat<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function print(msg: string) {
  process.stdout.write(`${msg}\n`);
}

export async function resolveElementObjectId(
  client: import('../index.js').CdpClient,
  sessionId: string,
  refs: Map<string, import('../index.js').ElementRef>,
  refOrSelector: string,
): Promise<string> {
  const browser = await getBrowser();
  if (refOrSelector.startsWith('@') || /^e\d+$/.test(refOrSelector)) {
    const key = refOrSelector.startsWith('@') ? refOrSelector.slice(1) : refOrSelector;
    const ref = await browser.resolveRef(client, sessionId, refs, key);
    const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
    if (!objectId) throw new Error(`Element @${key} not found in DOM`);
    return objectId;
  }
  // CSS selector path
  const res = await client.send<{ result: { objectId?: string; subtype?: string } }>(
    'Runtime.evaluate',
    {
      expression: `document.querySelector(${JSON.stringify(refOrSelector)})`,
      returnByValue: false,
    },
    sessionId,
  );
  if (!res.result?.objectId || res.result?.subtype === 'null')
    throw new Error(`Selector not found: ${refOrSelector}`);
  return res.result.objectId;
}
