// Generated CLAUDE.md / CAPABILITIES.md must route agent choice through the
// pick index ([PICK] line, mcp__monomind__pick) and must only name agents that
// are installed: a Task subagent_type that is not an agent's frontmatter
// `name` fails at spawn time. The old tables named security-architect,
// code-review-swarm, perf-engineer, auditor, backend-dev, ... none of which
// exist.

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { generateClaudeMd } from '../init/claudemd-generator.js';
import {
  type ClaudeMdTemplate,
  DEFAULT_INIT_OPTIONS,
  detectPlatform,
  type InitResult,
} from '../init/types.js';
import { writeCapabilitiesDoc } from '../init/write-capabilities.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const AGENTS_DIR = join(__dirname, '..', '..', '.claude', 'agents');
const TEMPLATES: ClaudeMdTemplate[] = [
  'minimal',
  'standard',
  'full',
  'security',
  'performance',
  'solo',
];

function agentNames(dir: string, out = new Set<string>()): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) agentNames(full, out);
    else if (entry.endsWith('.md')) {
      const m = readFileSync(full, 'utf8').match(/^---\n[\s\S]*?^name:\s*["']?(.+?)["']?\s*$/m);
      if (m) out.add(m[1]);
    }
  }
  return out;
}
const AGENTS = agentNames(AGENTS_DIR);

/** Text of the `## <heading>` section up to the next `## ` heading. */
function section(doc: string, heading: string): string {
  const start = doc.indexOf(`## ${heading}`);
  if (start < 0) return '';
  const rest = doc.slice(start + heading.length + 3);
  const end = rest.search(/^## /m);
  return end < 0 ? rest : rest.slice(0, end);
}

/** Agent names a doc offers as spawnable: roster sections and routing tables. */
function offeredAgents(doc: string): string[] {
  const names: string[] = [];
  const roster = section(doc, 'Available Agents');
  for (const line of roster.split('\n')) {
    // Only list lines (comma-separated backticked names), not prose bullets.
    if (!/^`[^`]+`(,\s*`[^`]+`)*\s*$/.test(line.trim())) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) names.push(m[1]);
  }
  const routing = doc.match(/### Agent Routing[\s\S]*?(?=\n### |\n## |$)/)?.[0] ?? '';
  for (const row of routing.split('\n')) {
    const cells = row.split('|').map((c) => c.trim());
    if (cells.length < 4 || !/^\d+$/.test(cells[1])) continue;
    for (const n of cells[3].split(',')) names.push(n.trim());
  }
  for (const m of doc.matchAll(/subagent_type:\s*"([^"]+)"/g)) names.push(m[1]);
  return names;
}

function freshResult(): InitResult {
  return {
    success: true,
    platform: detectPlatform(),
    created: { directories: [], files: [] },
    updated: [],
    skipped: [],
    removed: [],
    errors: [],
    summary: { skillsCount: 0, commandsCount: 0, agentsCount: 0, hooksEnabled: 0 },
  };
}

async function capabilitiesDoc(): Promise<string> {
  const tmp = mkdtempSync(join(tmpdir(), 'monomind-agent-picking-'));
  try {
    const targetDir = join(tmp, 'project');
    mkdirSync(join(targetDir, '.monomind'), { recursive: true });
    await writeCapabilitiesDoc(targetDir, { ...DEFAULT_INIT_OPTIONS, targetDir }, freshResult());
    return readFileSync(join(targetDir, '.monomind', 'CAPABILITIES.md'), 'utf-8');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

describe('generated docs route agent choice through the pick index', () => {
  it('reads a real agent roster', () => {
    expect(AGENTS.size).toBeGreaterThan(50);
    expect(AGENTS.has('coder')).toBe(true);
    expect(AGENTS.has('Security Engineer')).toBe(true);
  });

  it.each(TEMPLATES)(
    '%s: tells Claude to follow [PICK] and to call mcp__monomind__pick',
    (tmpl) => {
      const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl);
      expect(doc).toContain('When a prompt carries a `[PICK]` line');
      expect(doc).toContain('unless it is clearly wrong');
      expect(doc).toContain('Before choosing a subagent yourself, call `mcp__monomind__pick`');
    },
  );

  // Older MCP servers (and the npm release before pick shipped) have no
  // mcp__monomind__pick tool, so the guidance must name a CLI fallback.
  it.each(TEMPLATES)('%s: degrades to the pick CLI when the MCP tool is missing', (tmpl) => {
    const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl);
    expect(doc).toContain('`mcp__monomind__pick` if that tool is available');
    expect(doc).toContain('`monomind pick -t "<task>" --json`');
    expect(doc).toContain('`npx -y monomind pick -t "<task>" --json`');
  });

  it.each(TEMPLATES)('%s: names no retired agents in prose either', (tmpl) => {
    const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl);
    for (const retired of ['perf-analyzer', 'code-review-swarm', 'security-architect']) {
      expect(doc).not.toContain(`\`${retired}\``);
    }
  });

  it.each(TEMPLATES)('%s: every agent it offers is installed', (tmpl) => {
    const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, tmpl);
    const unknown = offeredAgents(doc).filter((n) => !AGENTS.has(n));
    expect(unknown).toEqual([]);
  });

  it('the full template offers agents at all (the check is not vacuous)', () => {
    const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, 'full');
    expect(offeredAgents(doc).length).toBeGreaterThan(10);
  });

  it('CAPABILITIES.md points at the pick index and offers only installed agents', async () => {
    const doc = await capabilitiesDoc();
    expect(doc).toContain('`mcp__monomind__pick` if that tool is available');
    expect(doc).toContain('`monomind pick -t "<task>" --json`');
    expect(doc).toContain('[PICK]');
    const offered = offeredAgents(doc);
    expect(offered.length).toBeGreaterThan(3);
    expect(offered.filter((n) => !AGENTS.has(n))).toEqual([]);
  });

  it('says what a pick result with confident: false means', () => {
    const doc = generateClaudeMd({ ...DEFAULT_INIT_OPTIONS, targetDir: process.cwd() }, 'standard');
    const picking = section(doc, 'Agent & Skill Picking');
    expect(picking).toMatch(/`confident`/);
    expect(picking).toMatch(/false/);
  });
});
