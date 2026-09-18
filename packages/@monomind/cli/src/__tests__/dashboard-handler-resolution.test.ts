/**
 * i-065-dash — 119 dashboard controls threw ReferenceError on click.
 *
 * Commit 9537930fb prefixed 161 function/const declarations with `_` across
 * dashboard.html, orgs.html and mastermind-diagram-fallback.html while
 * leaving every inline `onclick="name(...)"` (etc.) attribute pointing at
 * the unprefixed name. The existing dashboard-tabs-wiring.test.ts
 * regex-matches two onclick strings AS TEXT and never checks that the
 * handler resolves to anything — that is precisely how 119 broken handlers
 * shipped under a green suite. This file asserts the JOIN: every identifier
 * invoked from an inline event-handler attribute must resolve to an actual
 * global (a function/const/let/var/class declaration, a `window.X =`
 * assignment, or a key in an `Object.assign(window, {...})` block).
 *
 * No jsdom / DOM dependency — static extraction over the HTML text is
 * sufficient (and is exactly what measured the original 119). T7 uses
 * node:vm (no new package) to execute two specific, narrowly-extracted
 * functions and their real transitive dependencies — not the whole 14k-line
 * script, which has substantial top-level side effects (an `init()` call
 * that opens SSE connections, fetches, etc.) that would require far more
 * DOM stubbing than this property needs.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI_DIR = join(__dirname, '../ui');

const DASHBOARD_HTML = readFileSync(join(UI_DIR, 'dashboard.html'), 'utf-8');
const ORGS_HTML = readFileSync(join(UI_DIR, 'orgs.html'), 'utf-8');
const MASTERMIND_HTML = readFileSync(join(UI_DIR, 'mastermind-diagram-fallback.html'), 'utf-8');

// ── The resolution checker — this is the part that must assert the JOIN ───

const JS_KEYWORDS = new Set([
  'if',
  'else',
  'for',
  'while',
  'do',
  'switch',
  'case',
  'break',
  'continue',
  'return',
  'function',
  'var',
  'let',
  'const',
  'new',
  'delete',
  'typeof',
  'instanceof',
  'in',
  'of',
  'this',
  'null',
  'true',
  'false',
  'undefined',
  'void',
  'yield',
  'async',
  'await',
  'try',
  'catch',
  'finally',
  'throw',
  'class',
  'extends',
  'super',
  'import',
  'export',
  'default',
  'static',
]);

// Ambient DOM/JS globals routinely called from inline handlers that are
// never "our" handler names (`confirm(...)`, `fetch(...)`, etc.).
const BUILTINS = new Set([
  'alert',
  'confirm',
  'prompt',
  'console',
  'setTimeout',
  'setInterval',
  'clearTimeout',
  'clearInterval',
  'parseInt',
  'parseFloat',
  'isNaN',
  'encodeURIComponent',
  'decodeURIComponent',
  'JSON',
  'Object',
  'Array',
  'String',
  'Number',
  'Boolean',
  'Math',
  'Date',
  'Promise',
  'fetch',
  'requestAnimationFrame',
  'structuredClone',
]);

interface Invocation {
  name: string;
  line: number;
}

/**
 * Extracts every identifier invoked as `name(` from inline `on*="..."` /
 * `on*='...'` attributes. Strips nested single-quoted string *contents*
 * from the attribute value first — otherwise a CSS function embedded
 * entirely inside a string argument (e.g.
 * `onmouseover="this.style.background='rgba(255,255,255,0.06)'"`) is
 * mistaken for a handler call. A real handler call like
 * `onclick="switchMemTab('memories')"` is unaffected: only its string
 * *argument* is stripped, not the `switchMemTab(` prefix that precedes it.
 */
function extractInvokedHandlers(html: string): Invocation[] {
  const seen = new Set<string>();
  const invoked: Invocation[] = [];
  const attrRe = /\son[a-z]+=(["'])([\s\S]*?)\1/gi;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(html))) {
    const value = m[2];
    const line = html.slice(0, m.index).split('\n').length;
    const scanValue = value.replace(/'[^']*'/g, "''");
    const callRe = /([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
    let c: RegExpExecArray | null;
    while ((c = callRe.exec(scanValue))) {
      const name = c[1];
      if (scanValue[c.index - 1] === '.') continue; // method call (this.focus(), el.remove(), ...)
      if (JS_KEYWORDS.has(name) || BUILTINS.has(name)) continue;
      if (!seen.has(name)) {
        seen.add(name);
        invoked.push({ name, line });
      }
    }
  }
  return invoked;
}

/** Names resolvable as a global: function decls, top-level const/let/var,
 * class decls, `window.X = ...` assignments, and every key of every
 * `Object.assign(window, {...})` block. */
function extractResolvableGlobals(html: string): Set<string> {
  const resolvable = new Set<string>();
  let m: RegExpExecArray | null;

  const fnRe = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = fnRe.exec(html))) resolvable.add(m[1]);

  const varRe = /^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
  while ((m = varRe.exec(html))) resolvable.add(m[1]);

  const classRe = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = classRe.exec(html))) resolvable.add(m[1]);

  const winAssignRe = /\bwindow\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  while ((m = winAssignRe.exec(html))) resolvable.add(m[1]);

  for (const key of extractObjectAssignKeys(html)) resolvable.add(key);

  return resolvable;
}

/** Just the keys of every `Object.assign(window, {...})` block, in file order. */
function extractObjectAssignKeys(html: string): string[] {
  const keys: string[] = [];
  const oaRe = /Object\.assign\(\s*window\s*,\s*\{([\s\S]*?)\}\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = oaRe.exec(html))) {
    const keyRe = /(?:^|,)\s*(?:['"]?)([A-Za-z_$][A-Za-z0-9_$]*)(?:['"]?)\s*:/g;
    let k: RegExpExecArray | null;
    while ((k = keyRe.exec(m[1]))) keys.push(k[1]);
  }
  return keys;
}

function checkResolution(html: string) {
  const invoked = extractInvokedHandlers(html);
  const resolvable = extractResolvableGlobals(html);
  const unresolved = invoked.filter((i) => !resolvable.has(i.name));
  return { invoked, resolvable, unresolved };
}

/** Names declared as a global *other than* via an Object.assign(window,...)
 * block — i.e. what "already existed" before that block ran. Used to check
 * an Object.assign block doesn't silently clobber a pre-existing global of
 * the same name. */
function extractGloballyDeclaredExcludingObjectAssign(html: string): Set<string> {
  const declared = new Set<string>();
  let m: RegExpExecArray | null;
  const fnRe = /\bfunction\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  while ((m = fnRe.exec(html))) declared.add(m[1]);
  const varRe = /^\s*(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/gm;
  while ((m = varRe.exec(html))) declared.add(m[1]);
  const classRe = /\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
  while ((m = classRe.exec(html))) declared.add(m[1]);
  const winAssignRe = /\bwindow\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;
  while ((m = winAssignRe.exec(html))) declared.add(m[1]);
  return declared;
}

function findObjectAssignCollisions(html: string): string[] {
  const declared = extractGloballyDeclaredExcludingObjectAssign(html);
  return extractObjectAssignKeys(html).filter((k) => declared.has(k));
}

// ── T1-T3: every inline handler resolves, for all three files ─────────────

describe('dashboard-handler-resolution — every inline handler resolves to a global', () => {
  it('every inline handler in dashboard.html resolves to a global', () => {
    const { unresolved } = checkResolution(DASHBOARD_HTML);
    const detail = unresolved.map((u) => `${u.name} (dashboard.html:${u.line})`).join(', ');
    expect(unresolved, `unresolved handler(s): ${detail}`).toHaveLength(0);
  });

  it('every inline handler in orgs.html resolves to a global', () => {
    const { unresolved } = checkResolution(ORGS_HTML);
    const detail = unresolved.map((u) => `${u.name} (orgs.html:${u.line})`).join(', ');
    expect(unresolved, `unresolved handler(s): ${detail}`).toHaveLength(0);
  });

  it('every inline handler in mastermind-diagram-fallback.html resolves to a global', () => {
    const { unresolved } = checkResolution(MASTERMIND_HTML);
    const detail = unresolved
      .map((u) => `${u.name} (mastermind-diagram-fallback.html:${u.line})`)
      .join(', ');
    expect(unresolved, `unresolved handler(s): ${detail}`).toHaveLength(0);
  });
});

// ── T4: mandatory negative control ─────────────────────────────────────────
// "A subtly broken extractor silently passes everything, which is a more
// dangerous outcome than the bug, because it would look like proof."

describe('dashboard-handler-resolution — negative control', () => {
  it('the resolution checker reports a known-unresolvable handler', () => {
    const fixture = `
      <html><body>
        <button onclick="definitelyNotDefined()">Click me</button>
        <script>
          function realFn() {}
        </script>
      </body></html>
    `;
    const { unresolved } = checkResolution(fixture);
    expect(unresolved.map((u) => u.name)).toContain('definitelyNotDefined');
  });

  it('does NOT flag a handler that is genuinely declared', () => {
    const fixture = `
      <button onclick="realFn()">Click me</button>
      <script>function realFn() {}</script>
    `;
    const { unresolved } = checkResolution(fixture);
    expect(unresolved).toHaveLength(0);
  });
});

// ── T5: the canonical case ─────────────────────────────────────────────────

describe('dashboard-handler-resolution — canonical case', () => {
  it('switchMemTab resolves (invoked dashboard.html:1982-1988 by seven Memory sub-tab buttons; declared only as _switchMemTab at :3546 before this fix)', () => {
    const { invoked, resolvable } = checkResolution(DASHBOARD_HTML);
    expect(invoked.map((i) => i.name)).toContain('switchMemTab');
    expect(resolvable.has('switchMemTab')).toBe(true);
  });
});

// ── T6: CSS colour function false-positive pin ─────────────────────────────

describe('dashboard-handler-resolution — false positive pin', () => {
  it("a CSS colour function inside an attribute string is not treated as a handler (orgs.html: rgba/oklch inside this.style.background='...')", () => {
    const { invoked } = checkResolution(ORGS_HTML);
    const names = invoked.map((i) => i.name);
    // rgba(...) and oklch(...) both appear only as CSS function calls nested
    // inside a single-quoted string assigned to this.style.background from
    // onmouseover/onmouseout attributes — never as a bare handler call.
    // Do not widen the extractor to "fix" these; they were never broken.
    expect(names).not.toContain('rgba');
    expect(names).not.toContain('oklch');
  });

  it('pins the same false positive with a synthetic fixture, for both known CSS functions', () => {
    // Not just "the real file happens to pass today" — a fixture that fails
    // the same way if the nested-quote-stripping refinement is ever
    // removed or narrowed to only rgba. The plan named rgba as the
    // deliberate false positive T6 must pin; oklch is a second CSS function
    // with the identical structure (a color function nested inside a
    // single-quoted string assigned via onmouseover/onmouseout) found while
    // building the extractor — pin the class, not just the one instance.
    const fixture = `
      <button onmouseover="this.style.background='rgba(255,255,255,0.06)'"
              onmouseout="this.style.background='oklch(62% 0.22 25 / 0.08)'"
              onclick="realHandler()">X</button>
      <script>function realHandler() {}</script>
    `;
    const { invoked, unresolved } = checkResolution(fixture);
    const names = invoked.map((i) => i.name);
    expect(names).not.toContain('rgba');
    expect(names).not.toContain('oklch');
    expect(names).toContain('realHandler');
    expect(unresolved).toHaveLength(0);
  });
});

// ── Object.assign(window, ...) must not clobber an existing global ────────

describe('dashboard-handler-resolution — no clobbered globals', () => {
  it.each([
    ['dashboard.html', DASHBOARD_HTML],
    ['orgs.html', ORGS_HTML],
    ['mastermind-diagram-fallback.html', MASTERMIND_HTML],
  ])(
    '%s: no Object.assign(window, ...) key collides with an independently-declared global',
    (_label, html) => {
      expect(findObjectAssignCollisions(html)).toEqual([]);
    },
  );
});

// ── T7: page resilience — a failed route must not take the rest of the page
// down. Today a ReferenceError on click is contained (the rest of the tab
// keeps working); this fix must not trade that for an uncaught rejection
// that does the same damage a different way. ──────────────────────────────

/** Brace-counting extraction of one `function NAME(...) { ... }` body from
 * the real file text (naive, but safe for the three specific functions this
 * test extracts — none of them contain a string literal with an unbalanced
 * brace). Extracting from the real file (rather than hand-copying the
 * source into the test) means this stays honest if the function changes. */
function extractFunctionSource(html: string, name: string): string {
  const startRe = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`);
  const startMatch = startRe.exec(html);
  if (!startMatch) throw new Error(`extractFunctionSource: no "function ${name}(" found`);
  const braceOpen = html.indexOf('{', startMatch.index);
  let depth = 0;
  for (let i = braceOpen; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) return html.slice(startMatch.index, i + 1);
    }
  }
  throw new Error(`extractFunctionSource: unbalanced braces for ${name}`);
}

describe('dashboard-handler-resolution — T7: a failed route leaves the rest of the page usable', () => {
  it('invoking the handler behind the 404ing /api/monograph-wiki-search leaves an unrelated handler fully usable afterward', async () => {
    // Real source, extracted from dashboard.html (not hand-copied): the
    // debounced search handler (invoked as mgWikiSearchDebounced), its
    // apiFetch dependency (throws on a non-ok response — this is the exact
    // shape that made /api/monograph-wiki-search's 404 newly reachable once
    // this item makes the handler itself callable), and a second, wholly
    // unrelated handler with no network dependency at all.
    const mgWikiSearchDebouncedSrc = extractFunctionSource(
      DASHBOARD_HTML,
      '_mgWikiSearchDebounced',
    );
    const apiFetchSrc = extractFunctionSource(DASHBOARD_HTML, 'apiFetch');
    const closeReportCardSrc = extractFunctionSource(DASHBOARD_HTML, '_closeReportCard');

    expect(mgWikiSearchDebouncedSrc).toContain('/api/monograph-wiki-search');
    expect(closeReportCardSrc).not.toContain('fetch');

    const elements: Record<
      string,
      { innerHTML: string; classList: { remove: (...a: unknown[]) => void } }
    > = {
      'mg-wiki-list': { innerHTML: 'No nodes match', classList: { remove: () => {} } },
      'report-modal': { innerHTML: '', classList: { remove: () => {} } },
    };

    const uncaught: unknown[] = [];
    const sandbox: Record<string, unknown> = {
      DIR: '/tmp/fake-project',
      // Stub, not the real renderer — T7 tests error containment, not
      // search-result rendering.
      mgRenderWikiList: () => {},
      document: {
        getElementById: (id: string) => elements[id],
      },
      // Real fetch behavior stubbed to reproduce exactly the observed
      // production failure: /api/monograph-wiki-search 404s.
      fetch: async () => ({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => ({}),
      }),
      AbortController,
      setTimeout,
      clearTimeout,
      console,
      reportUncaught: (e: unknown) => uncaught.push(e),
    };
    vm.createContext(sandbox);

    vm.runInContext(
      `
      ${apiFetchSrc}
      let _mgWikiSearchTimer = null;
      function enc(s) { return encodeURIComponent(s); }
      ${mgWikiSearchDebouncedSrc}
      ${closeReportCardSrc}
      `,
      sandbox,
    );

    // Invoke the handler behind the 404ing route, exactly as an onclick/
    // oninput attribute would.
    (sandbox._mgWikiSearchDebounced as (q: string) => void)('some query');

    // The debounce is 300ms; give the fetch + .catch(() => {}) chain time
    // to settle. If that promise chain were missing its .catch, this is
    // where an unhandled rejection would surface.
    const rejections: unknown[] = [];
    const onRejection = (reason: unknown) => rejections.push(reason);
    process.on('unhandledRejection', onRejection);
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      process.off('unhandledRejection', onRejection);
    }

    expect(
      rejections,
      'unhandled rejection from the failed route leaked out of the handler',
    ).toEqual([]);
    expect(uncaught).toEqual([]);

    // The real assertion: a second, unrelated handler still runs cleanly
    // afterward — the failed route did not take the rest of the page down.
    expect(() => (sandbox._closeReportCard as () => void)()).not.toThrow();
    expect(elements['mg-wiki-list']).toBeDefined(); // sandbox/context itself still usable
  });
});
