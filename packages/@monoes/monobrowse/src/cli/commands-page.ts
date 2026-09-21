/**
 * Reading the page — accessibility snapshots, page/element properties, and
 * diffing one snapshot against another.
 *
 * `snapshot` is what mints the `@eN` refs every element command resolves
 * against; `get` reads url/title/text/html/box/attributes back out.
 */

import { output } from './output.js';
import { ensureConnected, getBrowser, print, session, truncateForOutput } from './session.js';
import type { Command, CommandContext, CommandResult } from './types.js';

export const snapshotCommand: Command = {
  name: 'snapshot',
  description: 'Capture accessibility snapshot with ref-based element handles (@e1, @e2, ...)',
  options: [
    {
      name: 'interactive',
      short: 'i',
      type: 'boolean',
      description: 'Interactive elements only (93% token reduction)',
      default: false,
    },
    {
      name: 'compact',
      short: 'c',
      type: 'boolean',
      description: 'Compact output format',
      default: false,
    },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
    { name: 'depth', short: 'd', type: 'number', description: 'Max depth of AX tree to show' },
    {
      name: 'selector',
      short: 's',
      type: 'string',
      description: 'Scope snapshot to a CSS selector',
    },
    {
      name: 'save',
      type: 'string',
      description: 'Save snapshot text to file (baseline for --diff)',
    },
    {
      name: 'diff',
      type: 'string',
      description: 'Compare current snapshot against a saved baseline file',
    },
    {
      name: 'content-boundaries',
      type: 'boolean',
      description: 'Wrap output in sentinel markers to prevent page-content injection attacks',
      default: false,
    },
    {
      name: 'max-output',
      type: 'number',
      description:
        'Truncate output to N characters (prevents context window blowout on large pages)',
    },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const result = await browser.captureSnapshot(client, sessionId, {
      interactiveOnly: ctx.flags.interactive as boolean,
      compact: ctx.flags.compact as boolean,
      maxDepth: ctx.flags.depth as number | undefined,
      selector: ctx.flags.selector as string | undefined,
    });

    session.refs = result.refs;
    await browser.saveRefCache(session.targetId, result.url, session.refs);

    const applyOutputLimits = (text: string): string => {
      const maxOutput = ctx.flags['max-output'] as number | undefined;
      let out = maxOutput ? truncateForOutput(text, maxOutput) : text;
      if (ctx.flags['content-boundaries']) {
        const nonce = Math.random().toString(36).slice(2, 10);
        out = `MONOMIND_PAGE_CONTENT nonce=${nonce} origin=${result.url}\n${out}\nEND_MONOMIND_PAGE_CONTENT nonce=${nonce}`;
      }
      return out;
    };

    // --save: write snapshot text to baseline file
    if (ctx.flags.save) {
      const { writeFile, mkdir } = await import('node:fs/promises');
      const { dirname } = await import('node:path');
      const savePath = ctx.flags.save as string;
      await mkdir(dirname(savePath), { recursive: true }).catch(() => {});
      await writeFile(savePath, result.text, 'utf8');
      output.printSuccess(`Snapshot saved to: ${savePath}`);
      return { success: true, data: { path: savePath } };
    }

    // --diff: compare against baseline file
    if (ctx.flags.diff) {
      const { readFile } = await import('node:fs/promises');
      const baselinePath = ctx.flags.diff as string;
      let baseline: string;
      try {
        baseline = await readFile(baselinePath, 'utf8');
      } catch {
        throw new Error(`Baseline not found: ${baselinePath}. Run snapshot --save first.`);
      }
      const currentLines = result.text.split('\n');
      const baselineLines = baseline.split('\n');
      const added: string[] = [],
        removed: string[] = [];
      const baseSet = new Set(baselineLines);
      const curSet = new Set(currentLines);
      for (const l of currentLines) if (!baseSet.has(l)) added.push(l);
      for (const l of baselineLines) if (!curSet.has(l)) removed.push(l);
      const changed = added.length > 0 || removed.length > 0;
      if (ctx.flags.json) {
        print(
          JSON.stringify({
            changed,
            additions: added.length,
            removals: removed.length,
            added,
            removed,
          }),
        );
      } else {
        if (!changed) {
          output.printSuccess('No snapshot changes detected');
        } else {
          output.printWarning(`Snapshot changed: +${added.length} lines, -${removed.length} lines`);
          for (const l of added) print(`\x1b[32m+ ${l}\x1b[0m`);
          for (const l of removed) print(`\x1b[31m- ${l}\x1b[0m`);
        }
      }
      return {
        success: true,
        data: { changed, additions: added.length, removals: removed.length },
      };
    }

    if (ctx.flags.json) {
      const refsObj = Object.fromEntries([...result.refs.entries()].map(([k, v]) => [k, v]));
      print(
        JSON.stringify({
          url: result.url,
          title: result.title,
          refs: refsObj,
          snapshot: result.text,
        }),
      );
    } else {
      print(`[${result.title}] ${result.url}\n`);
      print(applyOutputLimits(result.text));
    }

    return { success: true, data: result };
  },
};

export const getCommand: Command = {
  name: 'get',
  description:
    'Get page info. Usage: monomind browse get url|title|text|html|value|attr|count|box|styles [@ref] [attrName]',
  options: [{ name: 'json', type: 'boolean', description: 'Output as JSON', default: false }],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();

    const what = ctx.args[0] as string;
    if (!what)
      throw new Error('Usage: monomind browse get url|title|text|html|value|attr|count|box|styles');

    let value: unknown;

    switch (what) {
      case 'url':
        value = await browser.getCurrentUrl(client, sessionId);
        break;
      case 'title':
        value = await browser.getCurrentTitle(client, sessionId);
        break;
      case 'text': {
        const refArg = ctx.args[1] as string | undefined;
        if (refArg) {
          const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
          const ref = session.refs.get(refKey);
          if (!ref) throw new Error(`Ref @${refKey} not found`);
          const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
          if (!objectId) throw new Error('Element not in DOM');
          const result = await client.send<{ result: { value?: string } }>(
            'Runtime.callFunctionOn',
            {
              functionDeclaration:
                'function() { return this.innerText || this.textContent || ""; }',
              objectId,
              returnByValue: true,
            },
            sessionId,
          );
          value = result.result?.value ?? '';
        } else {
          value = (await browser.evaluateJs(
            client,
            sessionId,
            'document.body?.innerText ?? ""',
          )) as string;
        }
        break;
      }
      case 'html':
        value = (await browser.evaluateJs(
          client,
          sessionId,
          'document.documentElement.outerHTML',
        )) as string;
        break;
      case 'value': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get value @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = session.refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>(
          'Runtime.callFunctionOn',
          {
            functionDeclaration: 'function() { return this.value ?? null; }',
            objectId,
            returnByValue: true,
          },
          sessionId,
        );
        value = r.result?.value ?? null;
        break;
      }
      case 'attr': {
        const refArg = ctx.args[1] as string;
        const attrName = ctx.args[2] as string;
        if (!refArg || !attrName)
          throw new Error('Usage: monomind browse get attr @ref <attrName>');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = session.refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>(
          'Runtime.callFunctionOn',
          {
            functionDeclaration: `function() { return this.getAttribute(${JSON.stringify(attrName)}); }`,
            objectId,
            returnByValue: true,
          },
          sessionId,
        );
        value = r.result?.value ?? null;
        break;
      }
      case 'count': {
        const selector = ctx.args[1] as string;
        if (!selector) throw new Error('Usage: monomind browse get count <cssSelector>');
        value = await browser.evaluateJs(
          client,
          sessionId,
          `document.querySelectorAll(${JSON.stringify(selector)}).length`,
        );
        break;
      }
      case 'box': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get box @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = session.refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const center = await browser.getElementBox(client, sessionId, ref);
        value = deriveBoxOutput(center);
        break;
      }
      case 'styles': {
        const refArg = ctx.args[1] as string;
        if (!refArg) throw new Error('Usage: monomind browse get styles @ref');
        const refKey = refArg.startsWith('@') ? refArg.slice(1) : refArg;
        const ref = session.refs.get(refKey);
        if (!ref) throw new Error(`Ref @${refKey} not found`);
        const objectId = await browser.getObjectIdForRef(client, sessionId, ref);
        if (!objectId) throw new Error('Element not in DOM');
        const r = await client.send<{ result: { value?: string } }>(
          'Runtime.callFunctionOn',
          {
            functionDeclaration:
              'function() { const s = window.getComputedStyle(this); return JSON.stringify(Object.fromEntries([...s].map(k => [k, s.getPropertyValue(k)]))); }',
            objectId,
            returnByValue: true,
          },
          sessionId,
        );
        try {
          value = JSON.parse(r.result?.value ?? '{}');
        } catch {
          value = {};
        }
        break;
      }
      default:
        throw new Error(`Unknown: ${what}. Use: url|title|text|html|value|attr|count|box|styles`);
    }

    if (ctx.flags.json) {
      print(JSON.stringify({ data: { [what]: value } }));
    } else {
      print(typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? ''));
    }

    return { success: true, data: { [what]: value } };
  },
};

export function deriveBoxOutput(
  center: { x: number; y: number; width: number; height: number } | null,
): {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
} | null {
  if (!center) return null;
  return {
    x: center.x - center.width / 2,
    y: center.y - center.height / 2,
    width: center.width,
    height: center.height,
    centerX: center.x,
    centerY: center.y,
  };
}

export const diffCommand: Command = {
  name: 'diff',
  description:
    'Compare two URLs or snapshots. Usage: monomind browse diff url <url1> <url2> [--interactive] [--json]',
  options: [
    {
      name: 'interactive',
      short: 'i',
      type: 'boolean',
      description: 'Snapshot interactive elements only',
      default: false,
    },
    { name: 'json', type: 'boolean', description: 'Output as JSON', default: false },
  ],
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    const { client, sessionId } = await ensureConnected(session.port);
    const browser = await getBrowser();
    const subAction = ctx.args[0] as string;

    if (subAction === 'url') {
      const url1 = ctx.args[1] as string;
      const url2 = ctx.args[2] as string;
      if (!url1 || !url2) throw new Error('Usage: monomind browse diff url <url1> <url2>');

      // Capture snapshot at url1
      await browser.openUrl(client, sessionId, url1);
      await browser.waitFor(client, sessionId, { load: 'load', timeout: 15000 });
      const snap1 = await browser.captureSnapshot(client, sessionId, {
        interactiveOnly: ctx.flags.interactive as boolean,
      });

      // Capture snapshot at url2
      await browser.openUrl(client, sessionId, url2);
      await browser.waitFor(client, sessionId, { load: 'load', timeout: 15000 });
      const snap2 = await browser.captureSnapshot(client, sessionId, {
        interactiveOnly: ctx.flags.interactive as boolean,
      });

      session.refs = snap2.refs;
      await browser.saveRefCache(session.targetId, snap2.url, session.refs);

      // Text diff
      const lines1 = snap1.text.split('\n');
      const lines2 = snap2.text.split('\n');
      const set1 = new Set(lines1);
      const set2 = new Set(lines2);
      const onlyIn1: string[] = lines1.filter((l) => !set2.has(l));
      const onlyIn2: string[] = lines2.filter((l) => !set1.has(l));
      const changed = onlyIn1.length > 0 || onlyIn2.length > 0;

      if (ctx.flags.json) {
        print(
          JSON.stringify({
            changed,
            url1,
            url2,
            onlyIn1,
            onlyIn2,
            additions: onlyIn2.length,
            removals: onlyIn1.length,
          }),
        );
      } else {
        if (!changed) {
          output.printSuccess(`No differences between ${url1} and ${url2}`);
        } else {
          output.printWarning(
            `Diff: ${url1} vs ${url2} — +${onlyIn2.length} lines, -${onlyIn1.length} lines`,
          );
          for (const l of onlyIn1) print(`\x1b[31m- ${l}\x1b[0m`);
          for (const l of onlyIn2) print(`\x1b[32m+ ${l}\x1b[0m`);
        }
      }
      return {
        success: true,
        data: { changed, url1, url2, additions: onlyIn2.length, removals: onlyIn1.length },
      };
    }

    throw new Error('Usage: monomind browse diff url <url1> <url2>');
  },
};
