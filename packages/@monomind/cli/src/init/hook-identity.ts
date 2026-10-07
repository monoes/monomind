/**
 * Stable identity of a hook command (#655): the Monomind helper it runs and
 * that helper's argument, ignoring the shell wrapper around it. The wrapper
 * has changed between releases (`sh -c '… exec node "$p/.claude/helpers/x.cjs"
 * arg'` vs `node "$(…)/.claude/helpers/x.cjs" arg`), so exact command text
 * cannot tell an old registration from a new one. Not a Monomind helper:
 * the trimmed command itself.
 */
const HELPER = /\.claude\/helpers\/([\w./-]+\.(?:cjs|mjs|js))"?\s*([^'")|;&]*)/g;

export function hookIdentity(command: string): string {
  let last: RegExpExecArray | undefined;
  for (const m of command.matchAll(HELPER)) last = m;
  return last ? `${last[1]} ${last[2].trim()}`.trim() : command.trim();
}

/** Same event, matcher and helper+argument → the same hook. */
export function hookKey(event: string, matcher: string | undefined, command: string): string {
  return `${event}\0${matcher ?? ''}\0${hookIdentity(command)}`;
}
