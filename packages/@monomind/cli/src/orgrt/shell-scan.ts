// packages/@monomind/cli/src/orgrt/shell-scan.ts

/** Every command segment of a shell command, at any nesting depth — or an
 *  `opaque` reason when the scan met a construct it cannot delimit the way
 *  the shell does, so checkGitPolicy can fail closed. */
export interface ShellScan {
  segments: string[][];
  opaque?: string;
}

interface ScanCtx {
  /** inside `(`…`)`: stop at the matching `)` */
  close?: boolean;
  /** inside `$(`…`)` or `<(`…`)`, where a `case` pattern's `)` would end the scan early */
  inSub?: boolean;
  /** inside `$((`…`))` / `((`…`))`: quotes don't stop expansion and `<<` is a shift */
  arith?: boolean;
  /** not the outermost command string */
  nested?: boolean;
  depth: number;
}

const MAX_SHELL_NESTING = 32;

/**
 * Minimal quote-aware split of a shell command into segments (one per
 * `;`, `|`, `&`, `(`, `)` or newline) of whitespace-separated tokens, with
 * quotes and backslash escapes REMOVED from token text. Not a shell parser:
 * it exists only so the classifier sees `sh -c "git push"` as the tokens
 * `sh`, `-c`, `git push`, sees `git pu""sh` as `git push`, and does NOT see
 * `git commit -m "fix: git push hook"` as a second git call.
 *
 * The shell runs a command substitution wherever it appears, so `$(…)`,
 * backticks and `<(…)`/`>(…)` are scanned recursively — unquoted, inside
 * double quotes, in assignments, in `${…}` and in unquoted here-document
 * bodies — and their commands become segments of their own (#257: only an
 * unquoted `$(` used to be seen). The token keeps the raw substitution text,
 * so `git $(echo push)` stays unclassifiable. Only single quotes and quoted
 * here-documents are literal. Comments, here-document bodies and `$'…'` are
 * consumed the way the shell consumes them: a stray `'` in any of them used to
 * swallow every following line into one "quoted" token.
 */
export function shellSegments(cmd: string): ShellScan {
  const out: ShellScan = { segments: [] };
  scanShell(cmd, 0, out, { depth: 0 });
  return out;
}

/** The backtick substitution opening at `cmd[at]`: its body with the escapes
 *  the shell removes there, and the index of the closing backtick (-1 when
 *  unterminated). The first unescaped backtick closes it, quotes or not. */
function backtickBody(cmd: string, at: number, inDq: boolean): { body: string; end: number } {
  let body = '';
  for (let j = at + 1; j < cmd.length; j++) {
    if (cmd[j] === '`') return { body, end: j };
    const next = cmd[j + 1];
    if (
      cmd[j] === '\\' &&
      next !== undefined &&
      ('$`\\'.includes(next) || (inDq && next === '"'))
    ) {
      body += next;
      j++;
    } else body += cmd[j];
  }
  return { body, end: -1 };
}

/** The here-document body starting at `from`, up to its delimiter line, and
 *  the index just past that line. An unterminated body runs to the end. */
function readHeredoc(
  cmd: string,
  from: number,
  delim: string,
  stripTabs: boolean,
): { body: string; end: number } {
  const lines: string[] = [];
  let pos = from;
  while (pos < cmd.length) {
    const nl = cmd.indexOf('\n', pos);
    const lineEnd = nl === -1 ? cmd.length : nl;
    const line = cmd.slice(pos, lineEnd);
    pos = lineEnd + 1;
    if ((stripTabs ? line.replace(/^\t+/, '') : line) === delim)
      return { body: lines.join('\n'), end: Math.min(pos, cmd.length) };
    lines.push(line);
  }
  return { body: lines.join('\n'), end: cmd.length };
}

/** An unquoted here-document body is expanded, and quotes in it are literal:
 *  `'$(git push)'` there still runs. */
function scanHeredocBody(body: string, out: ShellScan, depth: number): void {
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\') i++;
    else if (body[i] === '$' && body[i + 1] === '(') {
      const arith = body[i + 2] === '(';
      i =
        scanShell(body, i + 2, out, {
          close: true,
          inSub: true,
          arith,
          nested: true,
          depth: depth + 1,
        }) - 1;
    } else if (body[i] === '`') {
      const { body: inner, end } = backtickBody(body, i, false);
      if (end < 0) {
        out.opaque ??= 'unterminated backtick substitution';
        return;
      }
      scanShell(inner, 0, out, { nested: true, depth: depth + 1 });
      i = end;
    }
  }
}

/** Scans `cmd` from `start` into `out`; returns the index just past the
 *  closing `)` when `ctx.close`, else `cmd.length`. */
function scanShell(cmd: string, start: number, out: ShellScan, ctx: ScanCtx): number {
  const fail = (why: string) => {
    out.opaque ??= why;
  };
  if (ctx.depth > MAX_SHELL_NESTING) {
    fail('shell constructs nested too deeply');
    return cmd.length;
  }
  let seg: string[] = [];
  let lineSegs: string[][] = [seg]; // segments begun on this line: a here-document body is their input
  let cur = '';
  let has = false; // current token has content (so `""` yields an empty token)
  let literal = false; // current token used quotes/escapes, so `"2">x` is a word, not an fd
  let redirectTarget = false; // next token is a redirection target, not an argument
  let quote: '"' | "'" | null = null;
  let braceDepth = 0; // inside an unquoted `${…}`: operators, `#` and `<<` are part of the word
  let dqBraceDepth = 0; // inside `${…}` within double quotes
  let bracketDepth = 0; // an unquoted `[` is open: `a[1<<2]=x` holds a shift, not a here-document
  let heredocStrip: boolean | null = null; // the next word is a here-document delimiter (`<<-` strips tabs)
  const heredocs: { delim: string; quoted: boolean; strip: boolean; owner: string[] }[] = [];
  const flush = () => {
    if (has && heredocStrip !== null) {
      heredocs.push({ delim: cur, quoted: literal, strip: heredocStrip, owner: seg });
      heredocStrip = null;
    } else if (has && !redirectTarget) {
      if (ctx.inSub && !literal && cur === 'case')
        fail('case statement inside a command substitution');
      seg.push(cur);
    }
    if (has) redirectTarget = false;
    cur = '';
    has = false;
    literal = false;
  };
  const endSegment = () => {
    flush();
    redirectTarget = false;
    bracketDepth = 0;
    if (seg.length) out.segments.push(seg);
    seg = [];
    lineSegs.push(seg);
  };
  const finish = (end: number): number => {
    endSegment();
    if (ctx.nested && (heredocs.length > 0 || heredocStrip !== null))
      fail('here-document left open inside a substitution');
    return end;
  };
  // `$(…)`, `<(…)` or `>(…)` at cmd[at]: its commands become segments, its raw text stays in the token
  const substitution = (at: number): number => {
    const arith = cmd[at] === '$' && cmd[at + 2] === '(';
    const end = scanShell(cmd, at + 2, out, {
      close: true,
      inSub: true,
      arith,
      nested: true,
      depth: ctx.depth + 1,
    });
    cur += cmd.slice(at, end);
    has = true;
    return end - 1;
  };
  const backtick = (at: number, inDq: boolean): number => {
    const { body, end } = backtickBody(cmd, at, inDq);
    if (end < 0) {
      fail('unterminated backtick substitution');
      return cmd.length;
    }
    scanShell(body, 0, out, { nested: true, depth: ctx.depth + 1 });
    cur += cmd.slice(at, end + 1);
    has = true;
    return end;
  };
  const newline = (at: number): number => {
    flush();
    if (heredocStrip !== null) {
      fail('here-document operator without a delimiter');
      heredocStrip = null;
    }
    let pos = at + 1;
    for (const h of heredocs) {
      const { body, end } = readHeredoc(cmd, pos, h.delim, h.strip);
      pos = end;
      if (!h.quoted) scanHeredocBody(body, out, ctx.depth);
      // the body is stdin for its line's pipeline: `sh <<EOF`, `cat <<EOF | sh`
      for (const s of lineSegs.slice(lineSegs.indexOf(h.owner))) if (s.length) s.push(body);
    }
    heredocs.length = 0;
    endSegment();
    lineSegs = [seg];
    return pos - 1;
  };
  for (let i = start; i < cmd.length; i++) {
    const c = cmd[i];
    if (quote === "'" && !ctx.arith) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (quote) {
      // double quotes — and single quotes inside arithmetic, which still expand: `$(( '$(x)' ))`
      if (c === quote) {
        if (dqBraceDepth > 0) fail('quotes nested inside ${…} within double quotes');
        quote = null;
        dqBraceDepth = 0;
      } else if (c === '\\' && i + 1 < cmd.length) cur += cmd[++i];
      else if (c === '$' && cmd[i + 1] === '(') i = substitution(i);
      else if (c === '`') i = backtick(i, quote === '"');
      else {
        if (c === '$' && cmd[i + 1] === '{') dqBraceDepth++;
        else if (c === '}' && dqBraceDepth > 0) dqBraceDepth--;
        cur += c;
      }
      continue;
    }
    const procSub = (c === '<' || c === '>') && cmd[i + 1] === '(';
    if (braceDepth > 0 && !procSub && !'"\'\\$`'.includes(c)) {
      if (c === '}') braceDepth--;
      cur += c;
      has = true;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
      literal = true;
    } else if (c === '$' && cmd[i + 1] === "'" && !ctx.arith) {
      // ANSI-C quoting: `\'` does not close it
      let j = i + 2;
      while (j < cmd.length && cmd[j] !== "'") j += cmd[j] === '\\' ? 2 : 1;
      if (j >= cmd.length) fail('unterminated quote');
      cur += cmd.slice(i + 2, j);
      i = j;
      has = true;
      literal = true;
    } else if (c === '\\' && i + 1 < cmd.length) {
      cur += cmd[++i];
      has = true;
      literal = true;
    } else if (c === '$' && cmd[i + 1] === '(') i = substitution(i);
    else if (c === '`') i = backtick(i, false);
    else if (c === '$' && cmd[i + 1] === '{') {
      braceDepth++;
      cur += '${';
      has = true;
      i++;
    } else if (procSub) {
      // `<(…)` runs even inside `${x:-…}`
      if (braceDepth === 0) flush();
      i = substitution(i);
    } else if (c === '<' || c === '>') {
      // Redirection (`2>/dev/null`, `>out`, `2>&1`, `<in`): the fd number and
      // the target are not arguments, and counting them misclassifies a
      // `git config` read as a write. Unquoted only — `"2">x` passes "2".
      if (/^\d+$/.test(cur) && !literal) {
        cur = '';
        has = false;
      } else flush();
      let op: string = c;
      while (i + 1 < cmd.length && '<>&|'.includes(cmd[i + 1])) op += cmd[++i];
      if (op === '<<' && cmd[i + 1] === '-') op += cmd[++i];
      if (op !== '<<' && op !== '<<-') {
        // a here-string's word is content (`sh <<<"git push"`), keep it visible
        redirectTarget = !op.startsWith('<<<');
      } else if (ctx.arith || bracketDepth > 0) {
        // `$((1<<2))`, `a[1<<2]=x`: a shift. If a later line could be read as a
        // here-document body after all, the scan can't vouch for it.
        if (cmd.includes('\n', i)) fail('`<<` that may or may not start a here-document');
        redirectTarget = true;
      } else heredocStrip = op === '<<-';
    } else if (c === '#' && !has && (i === start || ' \t\n;&|()<>'.includes(cmd[i - 1]))) {
      if (ctx.arith) fail('`#` inside arithmetic');
      // A comment (a `#` starting a word after a blank or operator — not after
      // e.g. a no-break space) runs to the end of the line, and its quotes and
      // parens mean nothing to the shell. Its words stay visible to the classifier.
      const nl = cmd.indexOf('\n', i);
      const end = nl === -1 ? cmd.length : nl;
      const words = cmd
        .slice(i, end)
        .split(/[\s"'`$()<>;|&\\{}]+/)
        .filter(Boolean);
      if (words.length) out.segments.push(words);
      i = end - 1;
    } else if (c === '[' || c === ']') {
      bracketDepth = Math.max(0, bracketDepth + (c === '[' ? 1 : -1));
      cur += c;
      has = true;
    } else if (c === '\n') i = newline(i);
    else if (c === '(') {
      endSegment();
      const arith = ctx.arith || cmd[i + 1] === '(';
      i =
        scanShell(cmd, i + 1, out, {
          close: true,
          inSub: ctx.inSub,
          arith,
          nested: true,
          depth: ctx.depth + 1,
        }) - 1;
    } else if (c === ')') {
      if (ctx.close) return finish(i + 1);
      endSegment();
    } else if (';|&'.includes(c)) endSegment();
    else if (/\s/.test(c)) flush();
    else {
      cur += c;
      has = true;
    }
  }
  if (quote) fail('unterminated quote');
  if (braceDepth > 0) fail('unterminated ${…}');
  if (ctx.close) fail('unterminated command substitution or subshell');
  return finish(cmd.length);
}
