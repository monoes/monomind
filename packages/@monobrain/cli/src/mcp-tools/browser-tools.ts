/**
 * Browser MCP Tools
 *
 * CLI integration for @monobrain/browser package.
 * Provides browser automation tools for web navigation, interaction, and data extraction.
 */

import type { MCPTool, MCPToolResult } from './types.js';

// Session registry for multi-session support
const browserSessions = new Map<string, {
  sessionId: string;
  createdAt: string;
  lastActivity: string;
}>();

/**
 * Execute agent-browser CLI command
 */
async function execBrowserCommand(args: string[], session = 'default'): Promise<MCPToolResult> {
  const { execFileSync } = await import('child_process');

  try {
    const fullArgs = ['--session', session, '--json', ...args];
    const result = execFileSync('agent-browser', fullArgs, {
      encoding: 'utf-8',
      timeout: 30000,
    });

    let data;
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
      const { url, session, waitUntil } = input as {
        url: string;
        session?: string;
        waitUntil?: string;
      };
      const args = ['open', url];
      if (waitUntil) args.push('--wait-until', waitUntil);

      // Create session if new
      const sessionId = session || 'default';
      if (!browserSessions.has(sessionId)) {
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
      const { session, interactive, compact, depth, selector } = input as {
        session?: string;
        interactive?: boolean;
        compact?: boolean;
        depth?: number;
        selector?: string;
      };
      const args = ['snapshot'];
      if (interactive) args.push('-i');
      if (compact) args.push('-c');
      if (depth) args.push('-d', String(depth));
      if (selector) args.push('-s', selector);
      return execBrowserCommand(args, session);
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
      const { session, path, fullPage } = input as {
        session?: string;
        path?: string;
        fullPage?: boolean;
      };
      const args = ['screenshot'];
      if (path) args.push(path);
      if (fullPage) args.push('--full');
      return execBrowserCommand(args, session);
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
        target: string;
        session?: string;
        button?: string;
        count?: number;
      };
      const args = ['click', target];
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
      const { target, value, session } = input as {
        target: string;
        value: string;
        session?: string;
      };
      return execBrowserCommand(['fill', target, value], session);
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
        target: string;
        text: string;
        session?: string;
        delay?: number;
      };
      const args = ['type', target, text];
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
      const { key, session } = input as { key: string; session?: string };
      return execBrowserCommand(['press', key], session);
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
      const { target, session } = input as { target: string; session?: string };
      return execBrowserCommand(['hover', target], session);
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
      const { target, value, session } = input as {
        target: string;
        value: string;
        session?: string;
      };
      return execBrowserCommand(['select', target, value], session);
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
      const { target, session } = input as { target: string; session?: string };
      return execBrowserCommand(['check', target], session);
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
      const { target, session } = input as { target: string; session?: string };
      return execBrowserCommand(['uncheck', target], session);
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
      const { direction, amount, session } = input as {
        direction: string;
        amount?: number;
        session?: string;
      };
      const args = ['scroll', direction];
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
      const { target, session } = input as { target: string; session?: string };
      return execBrowserCommand(['get', 'text', target], session);
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
      const { target, session } = input as { target: string; session?: string };
      return execBrowserCommand(['get', 'value', target], session);
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
      const { selector, text, url, timeout, session } = input as {
        selector?: string;
        text?: string;
        url?: string;
        timeout?: number;
        session?: string;
      };
      const args = ['wait'];
      if (selector) args.push(selector);
      if (text) args.push('--text', text);
      if (url) args.push('--url', url);
      if (timeout) args.push(String(timeout));
      return execBrowserCommand(args, session);
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
      const { script, session } = input as { script: string; session?: string };
      return execBrowserCommand(['eval', script], session);
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
