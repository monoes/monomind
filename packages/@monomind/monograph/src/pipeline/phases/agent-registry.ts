import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { insertEdges } from '../../storage/edge-store.js';
import { insertNodes } from '../../storage/node-store.js';
import type { MonographEdge, MonographNode } from '../../types.js';
import { toNormLabel } from '../../types.js';
import type { PipelinePhase } from '../types.js';

const MAX_FILE_BYTES = 256 * 1024;
const MAX_REFERENCED_FILES = 20;
const PATH_RE = /[\w@./-]+\.(?:ts|tsx|mjs|cjs|js|json|md)/g;

export interface AgentDefinition {
  kind: 'Agent' | 'Skill';
  name: string;
  filePath: string;
  description: string;
  whenToUse: string;
  tags: string[];
  category: string;
  /** Markdown after the frontmatter. */
  body: string;
}

function unquote(v: string): string {
  const t = v.trim();
  return /^(".*"|'.*')$/s.test(t) ? t.slice(1, -1).replace(/\\(["'])/g, '$1') : t;
}

/**
 * Reads the flat `key: value` frontmatter agent and skill files use. Only the
 * keys the graph needs; nested blocks such as `capability:` are ignored.
 */
export function parseDefinition(
  kind: AgentDefinition['kind'],
  filePath: string,
  source: string,
): AgentDefinition | null {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(source);
  if (!m) return null;
  const fields = new Map<string, string>();
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields.set(kv[1], kv[2]);
  }
  const name = unquote(fields.get('name') ?? '');
  if (!name) return null;
  const tags = (fields.get('tags') ?? '')
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((t) => unquote(t))
    .filter(Boolean);
  return {
    kind,
    name,
    filePath,
    description: unquote(fields.get('description') ?? ''),
    whenToUse: unquote(fields.get('when_to_use') ?? ''),
    tags,
    category: unquote(fields.get('category') ?? ''),
    body: m[2],
  };
}

function* markdownFiles(dir: string): Generator<string> {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) yield* markdownFiles(full);
    else if (entry.endsWith('.md')) yield full;
  }
}

/** Agents under `.claude/agents/**` and skills at `.claude/skills/<name>/SKILL.md`. */
export function readDefinitions(repoPath: string): AgentDefinition[] {
  const out: AgentDefinition[] = [];
  const add = (kind: AgentDefinition['kind'], abs: string) => {
    try {
      if (statSync(abs).size > MAX_FILE_BYTES) return;
      const def = parseDefinition(kind, relative(repoPath, abs), readFileSync(abs, 'utf8'));
      if (def) out.push(def);
    } catch {
      /* unreadable definition: skip it, the rest still index */
    }
  };
  for (const abs of markdownFiles(join(repoPath, '.claude', 'agents'))) add('Agent', abs);
  const skills = join(repoPath, '.claude', 'skills');
  if (existsSync(skills)) {
    for (const entry of readdirSync(skills)) {
      const skillFile = join(skills, entry, 'SKILL.md');
      if (existsSync(skillFile)) add('Skill', skillFile);
    }
  }
  return out;
}

/** The searchable description of a definition, for the summaries index. */
export function definitionText(p: Record<string, unknown>, name: string): string {
  const tags = Array.isArray(p.tags) ? p.tags.join(' ') : '';
  return [name, p.description, p.whenToUse, tags, p.category]
    .filter((x) => typeof x === 'string' && x)
    .join(' ');
}

/**
 * Indexes the agent and skill definitions as `Agent` / `Skill` nodes, so "which
 * agent handles X" and "which code does this agent touch" are graph queries.
 * `.claude/` is excluded from the file scan on purpose (it is mirrored into
 * several platform trees), so this reads the root tree directly. Rebuilt from
 * scratch each build; a definition's REFERENCES edges point at the repository
 * files its text names.
 */
export const agentRegistryPhase: PipelinePhase<{ definitions: number }> = {
  name: 'agent-registry',
  deps: ['stale-sweep'],
  async execute(ctx) {
    const db = ctx.db;
    db.exec(
      "DELETE FROM edges WHERE source_id IN (SELECT id FROM nodes WHERE label IN ('Agent','Skill'))",
    );
    db.exec("DELETE FROM nodes WHERE label IN ('Agent','Skill')");

    const defs = readDefinitions(ctx.repoPath);
    if (defs.length === 0) return { definitions: 0 };

    const fileIds = new Map(
      (
        db.prepare("SELECT id, file_path FROM nodes WHERE label = 'File'").all() as {
          id: string;
          file_path: string;
        }[]
      ).map((r) => [r.file_path, r.id]),
    );

    const nodes: MonographNode[] = [];
    const edges: MonographEdge[] = [];
    for (const d of defs) {
      // Path-keyed, not slugged: two definitions can never share an id.
      const id = `${d.kind.toLowerCase()}:${d.filePath}`;
      nodes.push({
        id,
        label: d.kind,
        name: d.name,
        normLabel: toNormLabel(d.name),
        filePath: d.filePath,
        startLine: 1,
        isExported: true,
        properties: {
          description: d.description,
          whenToUse: d.whenToUse,
          tags: d.tags,
          category: d.category,
        },
      });
      const seen = new Set<string>();
      for (const match of d.body.matchAll(PATH_RE)) {
        const target = fileIds.get(match[0]);
        if (!target || seen.has(target) || seen.size >= MAX_REFERENCED_FILES) continue;
        seen.add(target);
        edges.push({
          id: `agent-ref:${id}>${target}`,
          sourceId: id,
          targetId: target,
          relation: 'REFERENCES',
          confidence: 'INFERRED',
          confidenceScore: 0.6,
          reason: `${d.kind.toLowerCase()} text names this file`,
        });
      }
    }
    insertNodes(db, nodes);
    insertEdges(db, edges);
    return { definitions: nodes.length };
  },
};
