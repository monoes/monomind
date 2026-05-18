/**
 * Tests for .claude/helpers/utils/micro-agents.cjs
 * Depends on ./monograph.cjs → ./telemetry.cjs; invalidate all three caches.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const TELE_PATH  = path.resolve(__dirname, '../../.claude/helpers/utils/telemetry.cjs');
const MONO_PATH  = path.resolve(__dirname, '../../.claude/helpers/utils/monograph.cjs');
const MICRO_PATH = path.resolve(__dirname, '../../.claude/helpers/utils/micro-agents.cjs');

function loadMicroAgents(cwd) {
  process.env.CLAUDE_PROJECT_DIR = cwd;
  delete require.cache[TELE_PATH];
  delete require.cache[MONO_PATH];
  delete require.cache[MICRO_PATH];
  return require(MICRO_PATH);
}

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ma-test-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.CLAUDE_PROJECT_DIR;
});

// ── _triggerExtractYamlValue ──────────────────────────────────────────────────

describe('micro-agents._triggerExtractYamlValue', () => {
  it('strips double quotes', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerExtractYamlValue('"hello world"')).toBe('hello world');
  });

  it('unescapes double-backslash inside double quotes', () => {
    const ma = loadMicroAgents(tmpDir);
    // YAML double-quoted "\\bauth\\b" → JS string \\bauth\\b → unescaped to \bauth\b
    expect(ma._triggerExtractYamlValue('"\\\\bauth\\\\b"')).toBe('\\bauth\\b');
  });

  it('strips single quotes', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerExtractYamlValue("'hello world'")).toBe('hello world');
  });

  it('returns unquoted value as-is', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerExtractYamlValue('plain-value')).toBe('plain-value');
  });

  it('trims surrounding whitespace', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerExtractYamlValue('  "trimmed"  ')).toBe('trimmed');
  });
});

// ── _triggerFinalize ──────────────────────────────────────────────────────────

describe('micro-agents._triggerFinalize', () => {
  it('returns object with pattern, mode, priority, agentSlug', () => {
    const ma = loadMicroAgents(tmpDir);
    const result = ma._triggerFinalize({ pattern: 'auth.*', mode: 'inject', priority: 5 }, 'my-agent');
    expect(result.pattern).toBe('auth.*');
    expect(result.mode).toBe('inject');
    expect(result.priority).toBe(5);
    expect(result.agentSlug).toBe('my-agent');
  });

  it('defaults mode to "inject" when not set', () => {
    const ma = loadMicroAgents(tmpDir);
    const result = ma._triggerFinalize({ pattern: 'test' }, 'agent-x');
    expect(result.mode).toBe('inject');
  });

  it('defaults priority to 0 when not set', () => {
    const ma = loadMicroAgents(tmpDir);
    const result = ma._triggerFinalize({ pattern: 'test' }, 'agent-x');
    expect(result.priority).toBe(0);
  });
});

// ── _triggerExtractFromFrontmatter ────────────────────────────────────────────

describe('micro-agents._triggerExtractFromFrontmatter', () => {
  it('returns [] for content without frontmatter', () => {
    const ma = loadMicroAgents(tmpDir);
    const result = ma._triggerExtractFromFrontmatter('No frontmatter here', 'my-agent');
    expect(result).toEqual([]);
  });

  it('returns [] for frontmatter without triggers section', () => {
    const ma = loadMicroAgents(tmpDir);
    const content = '---\nname: MyAgent\ndescription: A test agent\n---\n# Content';
    expect(ma._triggerExtractFromFrontmatter(content, 'my-agent')).toEqual([]);
  });

  it('extracts single trigger pattern', () => {
    const ma = loadMicroAgents(tmpDir);
    const content = '---\ntriggers:\n  - pattern: "security.*"\n    mode: inject\n---\n# Agent';
    const result = ma._triggerExtractFromFrontmatter(content, 'security-agent');
    expect(result.length).toBe(1);
    expect(result[0].pattern).toBe('security.*');
    expect(result[0].mode).toBe('inject');
    expect(result[0].agentSlug).toBe('security-agent');
  });

  it('extracts multiple trigger patterns', () => {
    const ma = loadMicroAgents(tmpDir);
    const content = '---\ntriggers:\n  - pattern: auth\n    mode: inject\n  - pattern: security\n    mode: takeover\n    priority: 10\n---';
    const result = ma._triggerExtractFromFrontmatter(content, 'agent');
    expect(result.length).toBe(2);
    expect(result[1].priority).toBe(10);
  });

  it('extracts takeover mode correctly', () => {
    const ma = loadMicroAgents(tmpDir);
    const content = '---\ntriggers:\n  - pattern: "\\\\bsecurity\\\\b"\n    mode: takeover\n    priority: 100\n---';
    const result = ma._triggerExtractFromFrontmatter(content, 'security');
    expect(result.length).toBe(1);
    expect(result[0].mode).toBe('takeover');
    expect(result[0].priority).toBe(100);
  });
});

// ── _triggerCollectMdFiles ────────────────────────────────────────────────────

describe('micro-agents._triggerCollectMdFiles', () => {
  it('returns [] for non-existent directory', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerCollectMdFiles(path.join(tmpDir, 'nonexistent'))).toEqual([]);
  });

  it('finds .md files in a directory', () => {
    const ma = loadMicroAgents(tmpDir);
    const agentDir = path.join(tmpDir, 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'agent-one.md'), '# Agent');
    fs.writeFileSync(path.join(agentDir, 'agent-two.md'), '# Agent');
    fs.writeFileSync(path.join(agentDir, 'config.json'), '{}'); // non-md, should not appear
    const result = ma._triggerCollectMdFiles(agentDir);
    expect(result.length).toBe(2);
    result.forEach(f => expect(f).toMatch(/\.md$/));
  });

  it('recursively finds .md files in subdirectories', () => {
    const ma = loadMicroAgents(tmpDir);
    const agentDir = path.join(tmpDir, 'agents');
    const subDir = path.join(agentDir, 'sub');
    fs.mkdirSync(subDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'top.md'), '# Top');
    fs.writeFileSync(path.join(subDir, 'nested.md'), '# Nested');
    const result = ma._triggerCollectMdFiles(agentDir);
    expect(result.length).toBe(2);
  });
});

// ── _triggerBuildIndex ────────────────────────────────────────────────────────

describe('micro-agents._triggerBuildIndex', () => {
  it('returns [] when agent directory does not exist', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma._triggerBuildIndex(path.join(tmpDir, 'no-agents'))).toEqual([]);
  });

  it('returns [] when no md files have trigger frontmatter', () => {
    const ma = loadMicroAgents(tmpDir);
    const agentDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'plain.md'), '# Just a plain agent\nNo triggers here.');
    expect(ma._triggerBuildIndex(agentDir)).toEqual([]);
  });

  it('builds index from agent files with trigger frontmatter', () => {
    const ma = loadMicroAgents(tmpDir);
    const agentDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    const content = '---\ntriggers:\n  - pattern: "fix.*bug"\n    mode: inject\n    priority: 5\n---\n# My Agent';
    fs.writeFileSync(path.join(agentDir, 'my-agent.md'), content);
    const result = ma._triggerBuildIndex(agentDir);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0].pattern).toBe('fix.*bug');
    expect(result[0].agentSlug).toBe('my-agent');
  });
});

// ── scanMicroAgentTriggers ────────────────────────────────────────────────────

describe('micro-agents.scanMicroAgentTriggers', () => {
  it('returns { matches: [], injectAgents: [] } for falsy prompt', () => {
    const ma = loadMicroAgents(tmpDir);
    expect(ma.scanMicroAgentTriggers('')).toEqual({ matches: [], injectAgents: [] });
    expect(ma.scanMicroAgentTriggers(null)).toEqual({ matches: [], injectAgents: [] });
  });

  it('returns empty matches when no agents dir and no index', () => {
    const ma = loadMicroAgents(tmpDir);
    const result = ma.scanMicroAgentTriggers('fix security vulnerability');
    expect(Array.isArray(result.matches)).toBe(true);
    expect(result.matches.length).toBe(0);
  });

  it('matches inject trigger from trigger-index.json cache', () => {
    const ma = loadMicroAgents(tmpDir);
    const indexPath = path.join(tmpDir, '.monomind', 'trigger-index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
      builtAt: new Date().toISOString(),
      patterns: [{ pattern: 'security', mode: 'inject', priority: 5, agentSlug: 'security-agent' }],
    }));
    const result = ma.scanMicroAgentTriggers('fix a security issue');
    expect(result.matches.length).toBe(1);
    expect(result.matches[0].agentSlug).toBe('security-agent');
    expect(result.injectAgents).toContain('security-agent');
  });

  it('returns takeoverAgent on takeover mode match', () => {
    const ma = loadMicroAgents(tmpDir);
    const indexPath = path.join(tmpDir, '.monomind', 'trigger-index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
      builtAt: new Date().toISOString(),
      patterns: [{ pattern: '\\btakeover\\b', mode: 'takeover', priority: 100, agentSlug: 'takeover-agent' }],
    }));
    const result = ma.scanMicroAgentTriggers('please takeover this task');
    expect(result.takeoverAgent).toBe('takeover-agent');
  });

  it('deduplicates: same agentSlug only matches once', () => {
    const ma = loadMicroAgents(tmpDir);
    const indexPath = path.join(tmpDir, '.monomind', 'trigger-index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    fs.writeFileSync(indexPath, JSON.stringify({
      builtAt: new Date().toISOString(),
      patterns: [
        { pattern: 'auth', mode: 'inject', priority: 5, agentSlug: 'auth-agent' },
        { pattern: 'authentication', mode: 'inject', priority: 3, agentSlug: 'auth-agent' },
      ],
    }));
    const result = ma.scanMicroAgentTriggers('authentication auth token');
    const slugs = result.matches.map(m => m.agentSlug);
    expect(slugs.filter(s => s === 'auth-agent').length).toBe(1);
  });

  it('ignores stale index and rebuilds from agents dir when index is > 1 hour old', () => {
    const ma = loadMicroAgents(tmpDir);
    const indexPath = path.join(tmpDir, '.monomind', 'trigger-index.json');
    fs.mkdirSync(path.dirname(indexPath), { recursive: true });
    // Stale index has a "security" pattern
    const staleTime = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    fs.writeFileSync(indexPath, JSON.stringify({
      builtAt: staleTime,
      patterns: [{ pattern: 'stale-pattern', mode: 'inject', priority: 1, agentSlug: 'stale-agent' }],
    }));
    // Agents dir has a fresh agent with a different pattern
    const agentDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'fresh-agent.md'),
      '---\ntriggers:\n  - pattern: "fresh-pattern"\n    mode: inject\n---\n# Fresh Agent');
    const result = ma.scanMicroAgentTriggers('fresh-pattern trigger');
    // Must match fresh-agent, not stale-agent
    expect(result.matches.some(m => m.agentSlug === 'fresh-agent')).toBe(true);
    expect(result.matches.some(m => m.agentSlug === 'stale-agent')).toBe(false);
  });

  it('sorts matches so higher-priority agents appear first', () => {
    const agentDir = path.join(tmpDir, '.claude', 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(path.join(agentDir, 'low-prio.md'),
      '---\ntriggers:\n  - pattern: "common-keyword"\n    mode: inject\n    priority: 1\n---\n# Low Priority Agent');
    fs.writeFileSync(path.join(agentDir, 'high-prio.md'),
      '---\ntriggers:\n  - pattern: "common-keyword"\n    mode: inject\n    priority: 10\n---\n# High Priority Agent');
    const ma = loadMicroAgents(tmpDir);
    const result = ma.scanMicroAgentTriggers('common-keyword task');
    expect(result.matches.length).toBeGreaterThanOrEqual(2);
    const priorities = result.matches.map(m => m.priority || 0);
    for (let i = 0; i < priorities.length - 1; i++) {
      expect(priorities[i]).toBeGreaterThanOrEqual(priorities[i + 1]);
    }
  });
});

// ── _buildKnowledgeSearchFn ───────────────────────────────────────────────────

describe('micro-agents._buildKnowledgeSearchFn', () => {
  it('returns an async function', () => {
    const ma = loadMicroAgents(tmpDir);
    const searchFn = ma._buildKnowledgeSearchFn(path.join(tmpDir, 'knowledge'));
    expect(typeof searchFn).toBe('function');
  });

  it('returns [] when chunks.jsonl does not exist', async () => {
    const ma = loadMicroAgents(tmpDir);
    const searchFn = ma._buildKnowledgeSearchFn(path.join(tmpDir, 'knowledge'));
    const result = await searchFn('authentication', {});
    expect(result).toEqual([]);
  });

  it('returns matching results from chunks.jsonl', async () => {
    const ma = loadMicroAgents(tmpDir);
    const knowledgeDir = path.join(tmpDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    const chunk = JSON.stringify({ chunkId: 'c1', namespace: 'knowledge:shared', text: 'authentication token jwt security verification', metadata: {} });
    fs.writeFileSync(path.join(knowledgeDir, 'chunks.jsonl'), chunk + '\n');
    const searchFn = ma._buildKnowledgeSearchFn(knowledgeDir);
    const result = await searchFn('authentication token', {});
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]).toHaveProperty('key');
    expect(result[0]).toHaveProperty('value');
    expect(result[0]).toHaveProperty('score');
  });

  it('filters by namespace when opts.namespace is set', async () => {
    const ma = loadMicroAgents(tmpDir);
    const knowledgeDir = path.join(tmpDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    const c1 = JSON.stringify({ chunkId: 'c1', namespace: 'knowledge:shared', text: 'authentication pattern', metadata: {} });
    const c2 = JSON.stringify({ chunkId: 'c2', namespace: 'other:ns', text: 'authentication pattern', metadata: {} });
    fs.writeFileSync(path.join(knowledgeDir, 'chunks.jsonl'), c1 + '\n' + c2 + '\n');
    const searchFn = ma._buildKnowledgeSearchFn(knowledgeDir);
    const result = await searchFn('authentication', { namespace: 'knowledge:shared' });
    // Only the knowledge:shared chunk should match
    expect(result.length).toBe(1);
    // All results should come from c1 (the knowledge:shared chunk)
    expect(result[0].key).toContain('c1');
  });

  it('returns empty for query with only stopwords', async () => {
    const ma = loadMicroAgents(tmpDir);
    const knowledgeDir = path.join(tmpDir, 'knowledge');
    fs.mkdirSync(knowledgeDir, { recursive: true });
    fs.writeFileSync(path.join(knowledgeDir, 'chunks.jsonl'), JSON.stringify({ chunkId: 'c1', text: 'the and or but', metadata: {} }) + '\n');
    const searchFn = ma._buildKnowledgeSearchFn(knowledgeDir);
    const result = await searchFn('the and or', {}); // all stopwords
    expect(result).toEqual([]);
  });
});
