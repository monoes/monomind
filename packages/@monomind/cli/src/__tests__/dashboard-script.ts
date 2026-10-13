/**
 * Test harness for the dashboard pages' inline scripts: pulls named top-level
 * functions out of src/ui/dashboard.html and runs them in a vm context with
 * stubbed browser globals, so their behavior can be asserted without a browser
 * (the repo has no jsdom). The page's functions are written at column 0 and end
 * with a column-0 `}`, which is what the extraction relies on.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export const UI_DIR = join(dirname(fileURLToPath(import.meta.url)), '../ui');

/** The inline `<script>` blocks of a ui page, joined (the markup around them is not JS). */
export function inlineScript(file: string): string {
  const html = readFileSync(join(UI_DIR, file), 'utf-8');
  return [...html.matchAll(/<script>\n([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
}

export const dashboardScript = inlineScript('dashboard.html');

/** Source of the named top-level (optionally async) function. */
export function topLevelFunction(src: string, name: string): string {
  const m = new RegExp(`^(?:async )?function ${name}\\(`, 'm').exec(src);
  if (!m) throw new Error(`function ${name} not found`);
  const end = src.indexOf('\n}\n', m.index);
  if (end < 0) throw new Error(`function ${name} has no column-0 closing brace`);
  return src.slice(m.index, end + 2);
}

/** A vm context holding the named page functions plus the given stub globals (timers by default). */
export function loadPageFunctions(
  script: string,
  names: string[] | 'all',
  globals: Record<string, unknown> = {},
) {
  const ctx = vm.createContext({
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    URL,
    AbortController,
    ...globals,
  });
  const wanted =
    names === 'all'
      ? [...script.matchAll(/^(?:async )?function ([\w$]+)\(/gm)].map((m) => m[1])
      : names;
  for (const n of wanted) {
    vm.runInContext(topLevelFunction(script, n), ctx, { filename: `page-script#${n}` });
  }
  return ctx as Record<string, any>;
}

/** Every identifier called from an inline event-handler attribute (`onclick="fn(...)"` ...). */
export function calledFromHandlers(html: string): Set<string> {
  const used = new Set<string>();
  for (const [, attr] of html.matchAll(/\bon[a-z]+="([^"]*)"/g)) {
    const code = attr.replace(/'(?:[^'\\]|\\.)*'/g, '""').replace(/\$\{[^}]*\}/g, '');
    for (const m of code.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*\(/g)) used.add(m[1]);
  }
  return used;
}

/** Names a page script makes callable from markup: function declarations, `window.x =`,
 *  top-level bindings and the keys of its `Object.assign(window, {...})` export block. */
export function definedGlobals(src: string): Set<string> {
  const defined = new Set<string>();
  const add = (re: RegExp, text = src) => {
    for (const m of text.matchAll(re)) defined.add(m[1]);
  };
  add(/^\s*(?:async )?function\s+([\w$]+)\s*\(/gm);
  add(/window\.([\w$]+)\s*=(?!=)/g);
  add(/^\s*(?:const|let|var)\s+([\w$]+)\s*=/gm);
  const exported = src.indexOf('Object.assign(window');
  if (exported >= 0) add(/^\s+([\w$]+):/gm, src.slice(exported));
  return defined;
}
