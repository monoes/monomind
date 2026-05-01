// ── Types ──────────────────────────────────────────────────────────────────────

export interface RouteShape {
  returnedKeys: string[];
  accessedKeys: string[];
  mismatches: string[];
  extra: string[];
  status: 'MATCH' | 'MISMATCH' | 'UNKNOWN';
}

// ── Internal helpers ──────────────────────────────────────────────────────────

/**
 * Given source starting at the opening `{`, walk char-by-char tracking brace
 * depth and return the substring of the outermost object literal (excluding
 * the surrounding braces).
 */
function extractObjectBody(source: string, start: number): string {
  let depth = 0;
  let bodyStart = -1;

  for (let i = start; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
      if (depth === 1) bodyStart = i + 1;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(bodyStart, i);
      }
    }
  }
  return '';
}

/**
 * Split an object body string by top-level commas (ignoring commas nested
 * inside `{}`, `[]`, or `()`).
 */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '{' || ch === '[' || ch === '(') depth++;
    else if (ch === '}' || ch === ']' || ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  const last = body.slice(start).trim();
  if (last.length > 0) parts.push(last);
  return parts;
}

/**
 * Extract the property key from a single key–value segment such as:
 *   `  id: 123`       → 'id'
 *   `  name: ...`     → 'name'
 *   `  ...spread`     → null  (spread, skip)
 *   `  shorthand`     → 'shorthand'  (computed or shorthand)
 */
function segmentToKey(segment: string): string | null {
  const trimmed = segment.trim();
  if (trimmed.startsWith('...')) return null; // spread
  if (trimmed.startsWith('[')) return null;   // computed key
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx > 0) {
    const key = trimmed.slice(0, colonIdx).trim();
    if (/^\w+$/.test(key)) return key;
    return null;
  }
  // shorthand property
  if (/^\w+$/.test(trimmed)) return trimmed;
  return null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Scan source code for patterns that indicate JSON response keys:
 *   `.json({ key1: ..., key2: ... })`
 *   `NextResponse.json({ key: ... })`
 *   `return { key1: ..., key2: ... }`
 *
 * Returns unique keys sorted alphabetically. Returns [] if no patterns found.
 */
export function extractHandlerReturnKeys(source: string): string[] {
  const keys = new Set<string>();

  // Anchors to look for before an opening brace
  const anchors = [
    /\.json\s*\(\s*(?=\{)/g,
    /NextResponse\.json\s*\(\s*(?=\{)/g,
    /return\s+(?=\{)/g,
  ];

  for (const anchorRe of anchors) {
    let match: RegExpExecArray | null;
    anchorRe.lastIndex = 0;
    while ((match = anchorRe.exec(source)) !== null) {
      // Find the opening brace starting from end of the match
      const braceIdx = source.indexOf('{', match.index + match[0].length - 1);
      if (braceIdx === -1) continue;

      const body = extractObjectBody(source, braceIdx);
      const segments = splitTopLevel(body);
      for (const seg of segments) {
        const key = segmentToKey(seg);
        if (key) keys.add(key);
      }
    }
  }

  return Array.from(keys).sort();
}

/**
 * Scan source code for property accesses on known response variable names:
 *   `data.key`
 *   `const { key1, key2 } = data`
 *
 * `varNames` defaults to common response variable names if not supplied.
 * Returns unique keys sorted alphabetically.
 */
export function extractAccessedKeys(
  source: string,
  varNames: string[] = ['data', 'result', 'response', 'res', 'json', 'body'],
): string[] {
  const keys = new Set<string>();

  for (const varName of varNames) {
    const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Dot access: varName.key (not followed by `(` — exclude method calls)
    const dotRe = new RegExp(`\\b${escaped}\\.(\\w+)(?!\\s*\\()`, 'g');
    let m: RegExpExecArray | null;
    while ((m = dotRe.exec(source)) !== null) {
      keys.add(m[1]);
    }

    // Destructuring: const { key1, key2 } = varName
    // or `const { key1: alias, key2 } = varName`
    const destructRe = new RegExp(
      `\\{([^}]*)\\}\\s*=\\s*${escaped}\\b`,
      'g',
    );
    while ((m = destructRe.exec(source)) !== null) {
      const inner = m[1];
      for (const part of inner.split(',')) {
        const trimmed = part.trim();
        if (!trimmed || trimmed.startsWith('...')) continue;
        // Handle `key: alias` — take the key (left side)
        const colonIdx = trimmed.indexOf(':');
        const key = colonIdx >= 0 ? trimmed.slice(0, colonIdx).trim() : trimmed;
        if (/^\w+$/.test(key)) keys.add(key);
      }
    }
  }

  return Array.from(keys).sort();
}

/**
 * Compare what a handler returns vs what consumers access.
 *
 * - MATCH: all accessed keys are present in returned keys
 * - MISMATCH: one or more accessed keys are missing from returned keys
 * - UNKNOWN: either set is empty
 */
export function compareShapes(
  returnedKeys: string[],
  accessedKeys: string[],
): RouteShape {
  if (returnedKeys.length === 0 || accessedKeys.length === 0) {
    return {
      returnedKeys,
      accessedKeys,
      mismatches: [],
      extra: [],
      status: 'UNKNOWN',
    };
  }

  const returnedSet = new Set(returnedKeys);
  const accessedSet = new Set(accessedKeys);

  const mismatches = accessedKeys.filter((k) => !returnedSet.has(k));
  const extra = returnedKeys.filter((k) => !accessedSet.has(k));

  return {
    returnedKeys,
    accessedKeys,
    mismatches,
    extra,
    status: mismatches.length === 0 ? 'MATCH' : 'MISMATCH',
  };
}
