/**
 * Running things in the page — `eval` for a single expression, `batch` for a
 * sequence of browse subcommands in one process, and the init scripts that run
 * before every navigation.
 *
 * The tokenizer is shared: a batch line is parsed the same way the CLI would
 * have parsed it on the command line, so `eval` expressions survive quoting.
 */

import { output } from './output.js';
import {
  DEFAULT_EVAL_MAX_OUTPUT,
  ensureConnected,
  getBrowser,
  print,
  session,
  truncateForOutput,
} from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const evalCommand: Command = {
  name: 'eval',
  description: 'Evaluate JavaScript in page context. Usage: monomind browse eval "document.title"',
  options: [
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    {
      name: 'stdin',
      type: 'boolean',
      description: 'Read JS expression from stdin (heredoc-friendly for multiline scripts)',
      default: false,
    },
    {
      name: 'max-output',
      type: 'number',
      description: `Truncate printed output to N characters (default ${DEFAULT_EVAL_MAX_OUTPUT}; 0 disables truncation)`,
    },
    {
      name: 'timeout',
      type: 'number',
      description: 'Max ms to wait for evaluation to settle (default 30000)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    let expr = ctx.args[0] as string;
    if (ctx.flags.stdin) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      expr = Buffer.concat(chunks).toString('utf8').trim();
    }
    if (!expr) throw new Error('Usage: monomind browse eval "<expression>" (or pipe with --stdin)');

    const timeoutMs = ctx.flags.timeout as number | undefined;
    const result = await browser.evaluateJs(client, sessionId, expr, timeoutMs);

    const maxOutput = (ctx.flags['max-output'] as number | undefined) ?? DEFAULT_EVAL_MAX_OUTPUT;
    if (ctx.flags.json) {
      print(truncateForOutput(JSON.stringify({ data: result }), maxOutput));
    } else {
      print(truncateForOutput(String(result ?? ''), maxOutput));
    }

    return { success: true, data: { result } };
  },
};

function tokenizeBatchCommand(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote: '"' | "'" | null = null;
  for (const ch of input.trim()) {
    if (inQuote) {
      if (ch === inQuote) {
        inQuote = null;
      } else {
        current += ch;
      }
    } else if (ch === '"' || ch === "'") {
      inQuote = ch;
    } else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Splits one line of a `batch` command string into a subcommand name, its
 * args, and any recognized leading flags.
 *
 * `eval` is special-cased: its sole argument is a raw JS expression, which
 * legitimately contains its own string-literal quotes (e.g.
 * `eval document.querySelector('a')`). tokenizeBatchCommand's shell-style
 * word-splitting treats `'...'`/`"..."` as grouping delimiters and discards
 * them — correct for a value like `fill @e1 "some text"`, but for `eval` it
 * silently deletes the expression's own quotes, turning a string literal
 * into a bare (undefined) identifier reference and producing a
 * ReferenceError instead of evaluating the intended expression. For `eval`,
 * only its own known --flags are consumed from the front; everything after
 * them is taken verbatim as one argument, untouched by tokenization.
 *
/**
 * `get box`'s output shape: browser.getElementBox() returns the element's
 * CENTER point under x/y (correct for internal click-target callers), but
 * `get box` is a bounding-box accessor where x/y conventionally means the
 * top-left origin — a caller computing its own center as `box.x + width/2`
 * would otherwise double-offset away from the element (issue #15). Expose
 * both conventions, explicitly labeled, so neither is ambiguous.
 *
 * Exported for direct unit testing — not part of the CLI's public API.
 */

export function parseBatchCommandLine(cmdStr: string): {
  subName: string;
  subArgs: string[];
  flags: Record<string, unknown>;
} {
  const trimmed = cmdStr.trim();
  const evalMatch = trimmed.match(/^eval\b\s*/);
  if (!evalMatch) {
    const parts = tokenizeBatchCommand(trimmed);
    return { subName: parts[0], subArgs: parts.slice(1), flags: {} };
  }

  let rest = trimmed.slice(evalMatch[0].length);
  const flags: Record<string, unknown> = {};
  let consumedAnother = true;
  while (consumedAnother) {
    consumedAnother = false;
    const withValue = rest.match(/^--(max-output|timeout)\s+(-?\d+)\s*/);
    if (withValue) {
      flags[withValue[1]] = Number(withValue[2]);
      rest = rest.slice(withValue[0].length);
      consumedAnother = true;
      continue;
    }
    const boolFlag = rest.match(/^--(json|stdin)\b\s*/);
    if (boolFlag) {
      flags[boolFlag[1]] = true;
      rest = rest.slice(boolFlag[0].length);
      consumedAnother = true;
    }
  }
  return { subName: 'eval', subArgs: [rest], flags };
}

export const addinitscriptCommand: Command = {
  name: 'addinitscript',
  description:
    'Add script to run before page navigation. Usage: monomind browse addinitscript "window.x=1"',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const script = ctx.args[0] as string;
    if (!script) throw new Error('Usage: monomind browse addinitscript "<js>"');
    const id = await browser.addInitScript(client, sessionId, script);
    output.printSuccess(`Init script added: ${id}`);
    return { success: true, data: { identifier: id } };
  },
};

export const removeinitscriptCommand: Command = {
  name: 'removeinitscript',
  description:
    'Remove a previously added init script. Usage: monomind browse removeinitscript <id>',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const id = ctx.args[0] as string;
    if (!id) throw new Error('Usage: monomind browse removeinitscript <identifier>');
    await browser.removeInitScript(client, sessionId, id);
    output.printSuccess(`Init script removed: ${id}`);
    return { success: true };
  },
};
