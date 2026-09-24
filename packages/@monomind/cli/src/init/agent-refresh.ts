/**
 * Refresh installed agent definitions from the bundle during `init upgrade`.
 *
 * Older installs carry agent files without `when_to_use` / `tags` /
 * `category`, which the pick index ranks on, and upgrade never touched an
 * existing agent file. An installed agent is replaced with its bundled
 * counterpart (same relative path, else same frontmatter `name`) only when
 * its body — everything after the frontmatter — is byte-identical to the
 * bundled body, i.e. only the metadata differs. An agent whose body differs
 * (edited locally, or from an older release) is left as it is and reported.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AgentRefreshResult {
  /** Installed paths (relative to the agents dir) replaced with the bundled file. */
  refreshed: string[];
  /** Installed paths with a bundled counterpart whose body differs — left alone. */
  kept: string[];
}

const FRONTMATTER = /^---\r?\n[\s\S]*?\r?\n---\r?\n/;
const MAX_AGENT_BYTES = 512 * 1024;

function markdownFiles(dir: string, base = dir, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) markdownFiles(full, base, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(path.relative(base, full));
  }
  return out;
}

function read(file: string): string | undefined {
  try {
    if (fs.statSync(file).size > MAX_AGENT_BYTES) return undefined;
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return undefined;
  }
}

function nameOf(text: string): string | undefined {
  const fm = text.match(FRONTMATTER)?.[0];
  return fm
    ?.match(/^name:\s*(.+)$/m)?.[1]
    .trim()
    .replace(/^["']|["']$/g, '');
}

const bodyOf = (text: string): string => text.replace(FRONTMATTER, '');

export function refreshBundledAgents(
  agentsDir: string,
  sourceAgentsDir: string,
): AgentRefreshResult {
  const result: AgentRefreshResult = { refreshed: [], kept: [] };
  if (!fs.existsSync(agentsDir) || !fs.existsSync(sourceAgentsDir)) return result;
  if (fs.realpathSync(agentsDir) === fs.realpathSync(sourceAgentsDir)) return result;

  const byName = new Map<string, string>();
  for (const rel of markdownFiles(sourceAgentsDir)) {
    const name = nameOf(read(path.join(sourceAgentsDir, rel)) ?? '');
    if (name && !byName.has(name)) byName.set(name, rel);
  }

  for (const rel of markdownFiles(agentsDir)) {
    const target = path.join(agentsDir, rel);
    const installed = read(target);
    if (installed === undefined) continue;
    const samePath = path.join(sourceAgentsDir, rel);
    const name = nameOf(installed);
    const sourceRel = fs.existsSync(samePath) ? rel : name ? byName.get(name) : undefined;
    if (!sourceRel) continue;
    const bundled = read(path.join(sourceAgentsDir, sourceRel));
    if (bundled === undefined || bundled === installed) continue;
    if (bodyOf(installed) !== bodyOf(bundled)) {
      result.kept.push(rel);
      continue;
    }
    const tmp = `${target}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, bundled, 'utf-8');
    fs.renameSync(tmp, target);
    result.refreshed.push(rel);
  }
  return result;
}
