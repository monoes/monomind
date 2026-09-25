/**
 * Merges for the two `.monomind/` files users are told to edit —
 * `config.yaml` and `.gitignore` — so `init --force` refreshes monomind's
 * defaults without discarding what the user added.
 */

interface YamlKeyLine {
  index: number;
  indent: number;
  path: string;
  /** True when the key carries no inline value, i.e. it opens a nested map. */
  isMap: boolean;
}

const KEY_LINE = /^( *)([^\s#:-][^:#]*?):(?:\s(.*))?$/;

/** Every `key:` line with its dotted path. Only the plain nested-map shape
 *  config.yaml uses is understood; anything else is carried as text. */
function keyLines(lines: readonly string[]): YamlKeyLine[] {
  const out: YamlKeyLine[] = [];
  const stack: { indent: number; key: string }[] = [];
  lines.forEach((line, index) => {
    const match = KEY_LINE.exec(line);
    if (!match) return;
    const indent = match[1].length;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    stack.push({ indent, key: match[2].trim() });
    const value = (match[3] ?? '').trim();
    out.push({
      index,
      indent,
      path: stack.map((s) => s.key).join('.'),
      isMap: value === '' || value.startsWith('#'),
    });
  });
  return out;
}

/** Index of the last line belonging to the key at `keys[at]` (its subtree). */
function subtreeEnd(lines: readonly string[], keys: readonly YamlKeyLine[], at: number): number {
  const next = keys.slice(at + 1).find((k) => k.indent <= keys[at].indent);
  let end = (next ? next.index : lines.length) - 1;
  while (end > keys[at].index && lines[end].trim() === '') end--;
  return end;
}

/**
 * Adds every key present in `generated` but absent from `existing`, under the
 * same parent, and changes nothing else: user keys, values, comments and order
 * are kept. A default whose parent the user turned into a scalar is skipped.
 */
export function mergeYamlDefaults(existing: string, generated: string): string {
  const genLines = generated.split('\n');
  const genKeys = keyLines(genLines);
  const lines = existing.replace(/\n+$/, '').split('\n');

  for (let g = 0; g < genKeys.length; g++) {
    const keys = keyLines(lines);
    const byPath = new Map(keys.map((k, i) => [k.path, i]));
    if (byPath.has(genKeys[g].path)) continue;
    const parentPath = genKeys[g].path.split('.').slice(0, -1).join('.');
    const parentAt = parentPath ? byPath.get(parentPath) : undefined;
    if (parentPath && (parentAt === undefined || !keys[parentAt].isMap)) continue;

    const block = genLines.slice(genKeys[g].index, subtreeEnd(genLines, genKeys, g) + 1);
    const insertAt = parentAt === undefined ? lines.length : subtreeEnd(lines, keys, parentAt) + 1;
    lines.splice(insertAt, 0, ...(parentAt === undefined ? ['', ...block] : block));
    // Skip the descendants just inserted along with their parent.
    const end = subtreeEnd(genLines, genKeys, g);
    while (g + 1 < genKeys.length && genKeys[g + 1].index <= end) g++;
  }
  return `${lines.join('\n')}\n`;
}

const GITIGNORE_BLOCK =
  /^# monomind:start gitignore\r?\n[\s\S]*?^# monomind:end gitignore(?:\r?\n|$)/m;

/**
 * Places `template` inside `# monomind:start gitignore` / `# monomind:end
 * gitignore` markers and keeps every other line. An existing block is
 * replaced in place. A file written before the markers existed has the
 * template's own lines removed (they now live in the block) and the block put
 * first, so user lines such as `!orgs/<org>.json` keep coming after the `*`
 * they re-include from — gitignore order matters.
 */
export function mergeGitignoreBlock(existing: string, template: string): string {
  const block = `# monomind:start gitignore\n${template.trimEnd()}\n# monomind:end gitignore\n`;
  if (GITIGNORE_BLOCK.test(existing)) return existing.replace(GITIGNORE_BLOCK, () => block);
  const own = new Set(template.split('\n').filter((line) => line.trim() !== ''));
  const rest = existing
    .split('\n')
    .filter((line) => !own.has(line))
    .join('\n')
    .replace(/^\s+/, '')
    .trimEnd();
  return rest ? `${block}\n${rest}\n` : block;
}
