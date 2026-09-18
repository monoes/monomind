import { deriveRebuildTarget } from './native-binding.js';

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
  const pairs = [
    ...text.matchAll(/NODE_MODULE_VERSION (\d+)[\s\S]{0,200}?NODE_MODULE_VERSION (\d+)/g),
  ];
  if (pairs.length > 0) {
    const [, builtFor, required] = pairs[pairs.length - 1];
    // Name the directory that actually owns the binary. Issue #231's reporter ran
    // `npm rebuild` five times from their project and against a separate global
    // copy, all of which left the loaded file byte-identical — because none of
    // them was the tree it lives in.
    const binaryPath = text.match(/The module '([^']+)'/)?.[1];
    const target = binaryPath ? deriveRebuildTarget(binaryPath) : null;
    const precise = target
      ? `The binary actually loaded is ${binaryPath} — rebuild it where it lives: ` +
        `\`cd ${target.rebuildCwd} && ${
          target.packageManager === 'pnpm'
            ? 'pnpm rebuild better-sqlite3'
            : 'npm rebuild better-sqlite3 --build-from-source'
        }\`. A rebuild run anywhere else will not touch that file. `
      : '';
    return (
      `Native module built for Node ABI ${builtFor}, but this Node needs ABI ${required} ` +
      `(NODE_MODULE_VERSION mismatch). ${precise}` +
      `Otherwise: delete the module's build/ or prebuilds/ ` +
      `directory and reinstall, or reinstall under the exact Node version you run ` +
      `monomind with. If a plain reinstall never changes the binary at all (same size, ` +
      `same mtime, every time), it's likely resolving a cached prebuilt asset instead of ` +
      `actually rebuilding — force a real from-source rebuild with ` +
      '`npm rebuild <module> --build-from-source`, or remove and reinstall the exact ' +
      'package directory (`rm -rf node_modules/<module> && npm install`), not just its ' +
      `build/ output. If that STILL doesn't change the binary, a stale global npm cache ` +
      `or a dependency-deduped copy elsewhere on disk may be the real cause — run ` +
      `\`node -e "console.log(require.resolve('better-sqlite3'))"\` from the project ` +
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
    const moduleMatch = text
      .slice(bindingsIdx)
      .match(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)[\\/]/);
    const moduleName = moduleMatch?.[1];
    return (
      `${moduleName ? `\`${moduleName}\`` : 'A native module'}'s binary was never built for ` +
      "this platform (not an ABI mismatch — it simply doesn't exist). This usually means its " +
      'install script was blocked or failed silently. Try: ' +
      `\`npm rebuild ${moduleName ?? '<module>'}\`, or check \`npm install-scripts ls\` for ` +
      'scripts still pending approval.'
    );
  }
  return null;
}

/**
 * Pulls the `node_modules/<pkg>` package name out of the FIRST such path
 * mentioned anywhere in a native-module error dump — both the ABI-mismatch
 * shape ("The module '.../node_modules/better-sqlite3/build/Release/...'
 * was compiled against...") and the "could not locate the bindings file"
 * shape name the offending package this way. Used to look up that module's
 * own on-disk freshness (see checkMonographFreshness in
 * doctor-project-checks.ts) so a since-rebuilt module doesn't keep getting
 * reported as a current failure just because an old build.log entry still
 * mentions it. Handles scoped (@scope/name) and unscoped package dirs.
 */
export function extractNativeModulePackageName(text: string): string | null {
  const match = text.match(/node_modules[\\/](@[^\\/]+[\\/][^\\/]+|[^\\/]+)[\\/]/);
  return match?.[1] ?? null;
}
