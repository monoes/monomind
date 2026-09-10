/**
 * Formats an Error together with its `.cause`, if present, so wrapper errors
 * (e.g. MonographError('Failed to open database at ...', err)) don't silently
 * drop the actionable detail attached as `cause`.
 */
export function formatErrorWithCause(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const cause = (err as { cause?: unknown }).cause;
  if (cause === undefined) return err.message;
  const causeText = cause instanceof Error ? cause.message : String(cause);
  return `${err.message}: ${causeText}`;
}

/**
 * Recognizes known native-addon load failure signatures (e.g. better-sqlite3
 * built against the wrong Node ABI) and returns a specific, actionable
 * message. Returns null when the text doesn't match a known pattern, so
 * callers can fall back to surfacing the raw text instead of a guess.
 */
export function classifyNativeModuleError(text: string): string | null {
  // build.log is append-only across every attempt ever made in this project
  // (both spawners open it with 'a' and never truncate), so a long-lived
  // project's log can hold several failures back to back. Match bounded
  // pairs (so "built for X" and "requires Y" stay from the same attempt,
  // not stitched together across two different ones) and take the LAST
  // pair — the most recent attempt — not the first.
  const pairs = [...text.matchAll(/NODE_MODULE_VERSION (\d+)[\s\S]{0,200}?NODE_MODULE_VERSION (\d+)/g)];
  if (pairs.length > 0) {
    const [, builtFor, required] = pairs[pairs.length - 1];
    return (
      `Native module built for Node ABI ${builtFor}, but this Node needs ABI ${required} ` +
      `(NODE_MODULE_VERSION mismatch). Try: delete the module's build/ or prebuilds/ ` +
      `directory and reinstall, or reinstall under the exact Node version you run ` +
      `monomind with. If reinstalling never changes the binary at all, a stale global ` +
      `npm cache or a dependency-deduped copy elsewhere on disk may be the real cause — ` +
      `run \`node -e "console.log(require.resolve('better-sqlite3'))"\` from the project ` +
      `to see which file is actually being loaded.`
    );
  }
  if (/was compiled against a different Node\.js version/.test(text)) {
    return (
      'Native module was compiled against a different Node.js version than the one ' +
      'currently running. Try re-compiling or re-installing it (npm rebuild or npm install).'
    );
  }
  // The `bindings` package's own message when a native addon's .node binary
  // was never produced at all (as opposed to built for the wrong ABI) —
  // typically because the install script that compiles/downloads it was
  // blocked (npm's script-approval prompts, --ignore-scripts, an
  // allowScripts policy) or failed silently. Different root cause from the
  // ABI-mismatch case above, so it gets its own message and remediation.
  const bindingsIdx = text.search(/Could not locate the bindings file\.\s*Tried:/i);
  if (bindingsIdx !== -1) {
    // Extract the module name from the FIRST candidate path listed after the
    // trigger phrase (not the first node_modules/ reference anywhere in the
    // text — a wrapping stack trace, e.g. through @monoes/monograph, would
    // otherwise be mistaken for the module that's actually missing). Handles
    // both scoped (@scope/name) and unscoped package directory names.
    const moduleMatch = text.slice(bindingsIdx).match(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)[\\/]/);
    const moduleName = moduleMatch?.[1];
    return (
      `${moduleName ? `\`${moduleName}\`` : 'A native module'}'s binary was never built for ` +
      'this platform (not an ABI mismatch — it simply doesn\'t exist). This usually means its ' +
      'install script was blocked or failed silently. Try: ' +
      `\`npm rebuild ${moduleName ?? '<module>'}\`, or check \`npm install-scripts ls\` for ` +
      'scripts still pending approval.'
    );
  }
  return null;
}
