/**
 * Login / CAPTCHA walls — how `open` notices one, and the round trip to a
 * visible browser window that lets a person get past it before the session
 * carries on headless with the cookies and localStorage they earned.
 *
 * Split out of session.ts, which keeps the session runtime itself.
 */

import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CdpClient } from '../index.js';
import { output } from './output.js';
import { getBrowser, session } from './session.js';

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
