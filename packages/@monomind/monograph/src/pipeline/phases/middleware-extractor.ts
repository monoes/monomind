// ── Middleware chain extractor ────────────────────────────────────────────────
//
// Pure regex-based extraction (no tree-sitter). Only scans the first 3000 chars
// of source for performance. Handles four patterns:
//
//   1. nested:  withAuth(withRateLimit(handler))
//   2. compose: compose(withAuth, withRateLimit)(handler)
//   3. array:   app.get('/path', authMiddleware, handler)   (args before handler)
//   4. none:    plain handler usage
//
// Next.js middleware.ts detection: if the source file itself exports a
// `middleware` function with a `matcher` config, it is treated as a middleware
// file rather than performing per-route handler scanning.

export type WrapperPattern = 'compose' | 'nested' | 'array' | 'none';

export interface MiddlewareInfo {
  middlewareNames: string[];
  wrapperPattern: WrapperPattern;
}

const SCAN_LIMIT = 3000;

/**
 * Extracts the middleware chain wrapping a named handler in source code.
 *
 * @param source     Full source text of the handler file.
 * @param handlerName  The name of the handler function to look for.
 * @returns  MiddlewareInfo with names in outermost-first order.
 */
export function extractMiddlewareChain(source: string, handlerName: string): MiddlewareInfo {
  const snippet = source.slice(0, SCAN_LIMIT);

  // ── Pattern 0: Next.js middleware.ts ──────────────────────────────────────
  // If the file exports a `middleware` function and has a `matcher` config,
  // treat it as a global middleware file — no per-route wrapping to extract.
  const isNextMiddleware =
    /export\s+(?:default\s+)?(?:async\s+)?function\s+middleware\b/.test(snippet) &&
    /matcher/.test(snippet);
  if (isNextMiddleware) {
    return { middlewareNames: ['middleware.ts'], wrapperPattern: 'none' };
  }

  // ── Pattern 1: compose / pipe ─────────────────────────────────────────────
  // Matches: compose(withAuth, withRateLimit)(handler)  or  pipe(...)(handler)
  const composeRe = /(?:compose|pipe)\s*\(([\s\S]*?)\)\s*\(\s*HANDLER_NAME\s*\)/;
  const composeSrc = composeRe.source.replace('HANDLER_NAME', escapeRe(handlerName));
  const composeMatch = new RegExp(composeSrc, 'i').exec(snippet);
  if (composeMatch) {
    const names = composeMatch[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
    if (names.length > 0) {
      return { middlewareNames: names, wrapperPattern: 'compose' };
    }
  }

  // ── Pattern 2: nested wrappers ────────────────────────────────────────────
  // Matches: withAuth(withRateLimit(handler)) — walks outward iteratively.
  const nestedNames = extractNestedWrappers(snippet, handlerName);
  if (nestedNames.length > 0) {
    return { middlewareNames: nestedNames, wrapperPattern: 'nested' };
  }

  // ── Pattern 3: array / positional args (Express-style) ───────────────────
  // Matches: app.METHOD('/path', mw1, mw2, handler)
  // Extract identifiers that appear *before* the handler in the same call.
  const arrayNames = extractArrayMiddleware(snippet, handlerName);
  if (arrayNames.length > 0) {
    return { middlewareNames: arrayNames, wrapperPattern: 'array' };
  }

  return { middlewareNames: [], wrapperPattern: 'none' };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Escape a string for use as a regex literal. */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Walk outward from the innermost `wrapper(handler)` occurrence.
 * Returns names in outermost-first order, e.g. ['withAuth', 'withRateLimit']
 * for `withAuth(withRateLimit(handler))`.
 */
function extractNestedWrappers(snippet: string, handlerName: string): string[] {
  const wrappers: string[] = [];
  let inner = escapeRe(handlerName);

  // Each iteration tries to find `someIdent(inner)` in the snippet.
  // Limit iterations to prevent pathological loops.
  for (let i = 0; i < 10; i++) {
    const re = new RegExp(`([A-Za-z_$][\\w$]*)\\s*\\(\\s*${inner}\\s*\\)`, 'i');
    const m = re.exec(snippet);
    if (!m) break;
    wrappers.unshift(m[1]); // outermost first
    inner = escapeRe(m[1]) + `\\s*\\(\\s*${inner}\\s*\\)`;
  }

  return wrappers;
}

/**
 * Detect Express-style middleware arrays:
 *   app.get('/path', mw1, mw2, handler)
 * Returns identifier args that appear before `handler` in the same call.
 */
function extractArrayMiddleware(snippet: string, handlerName: string): string[] {
  // Match: something.method('path', ...args, handler  — capture everything before handler
  const re = new RegExp(
    `\\.(?:get|post|put|delete|patch|use)\\s*\\(\\s*['"][^'"]*['"]\\s*,\\s*([^)]+?)\\s*\\b${escapeRe(handlerName)}\\b`,
    'i',
  );
  const m = re.exec(snippet);
  if (!m) return [];

  const before = m[1];
  const names = before
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));

  return names;
}
