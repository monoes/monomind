#!/usr/bin/env node
/**
 * understand-analyze.mjs — Built-in semantic enrichment engine for monomind:understand
 *
 * Ported from Understand-Anything (understand-anything-plugin/packages/core).
 * Ships inside @monomind/cli — no external plugin needed.
 *
 * Reads file nodes from monograph.db, calls the Anthropic API to generate
 * summaries, tags, complexity, and architectural layers, then writes results
 * back into the DB (and optionally emits a graph.json).
 *
 * Usage:
 *   node understand-analyze.mjs [options]
 *
 * Options:
 *   --dir <path>          Project directory (default: cwd)
 *   --db  <path>          monograph.db path (default: <dir>/.monomind/monograph.db)
 *   --output <path>       Write a graph.json here (default: <dir>/.understand/knowledge-graph.json)
 *   --batch-size <N>      Files per LLM batch (default: 5)
 *   --max-files <N>       Stop after N files (0 = all, default: 0)
 *   --dry-run             Print what would happen without writing to DB
 *   --no-llm              Heuristic-only mode (layers + tags from paths, no API calls)
 *   --layers-only         Skip per-file analysis, only (re-)detect layers
 *
 * Env:
 *   ANTHROPIC_API_KEY     Required unless --no-llm is set
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname, basename, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dir = dirname(fileURLToPath(import.meta.url));
const CWD   = process.cwd();

// ── CLI argument helpers ─────────────────────────────────────────────────────
function argVal(name) {
  const i = process.argv.indexOf('--' + name);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = (f) => process.argv.includes('--' + f);

const projectDir  = resolve(argVal('dir')  || CWD);
const dbPathArg   = argVal('db')   ? resolve(argVal('db'))   : join(projectDir, '.monomind', 'monograph.db');
const outputArg   = argVal('output')? resolve(argVal('output')) : join(projectDir, '.understand', 'knowledge-graph.json');
const batchSize      = parseInt(argVal('batch-size') || '5',  10);
const maxFiles       = parseInt(argVal('max-files')  || '0',  10);
const dryRun         = hasFlag('dry-run');
const noLlm          = hasFlag('no-llm');
const layersOnly     = hasFlag('layers-only');
const incremental    = hasFlag('incremental');
const onboard        = hasFlag('onboard');
const onboardOut     = argVal('onboard-out') ? resolve(argVal('onboard-out')) : join(projectDir, 'ONBOARDING.md');

// ── Resolve @monoes/monograph for DB access ──────────────────────────────────
function resolveMonograph() {
  const req = createRequire(import.meta.url);
  const candidates = [
    // CLI package's own node_modules (npx / global npm install)
    join(__dir, '..', 'node_modules', '@monoes', 'monograph'),
    // Global npm / homebrew
    (() => { try { return join(req.resolve('npm/bin/npm-cli.js'), '..', '..', '..', '@monoes', 'monograph'); } catch { return null; } })(),
    // Monorepo root
    join(__dir, '..', '..', '..', '..', 'node_modules', '@monoes', 'monograph'),
    // User project
    join(projectDir, 'node_modules', '@monoes', 'monograph'),
  ].filter(Boolean);

  for (const c of candidates) {
    try {
      if (existsSync(c)) return req(c);
    } catch {}
  }
  // Last resort: require by name (works when installed globally)
  try { return req('@monoes/monograph'); } catch {}
  return null;
}

// ── Heuristic layer detection (ported from understand-anything layer-detector) ─
const LAYER_PATTERNS = [
  { patterns: ['routes', 'controller', 'handler', 'endpoint', 'api'],     name: 'API Layer',           description: 'HTTP endpoints, route handlers, and API controllers' },
  { patterns: ['service', 'usecase', 'use-case', 'business'],              name: 'Service Layer',       description: 'Business logic and application services' },
  { patterns: ['model', 'entity', 'schema', 'database', 'db', 'migration','repository', 'repo'],
                                                                            name: 'Data Layer',          description: 'Data models, database access, and persistence' },
  { patterns: ['component', 'view', 'page', 'screen', 'layout', 'widget', 'ui'],
                                                                            name: 'UI Layer',            description: 'User interface components and views' },
  { patterns: ['middleware', 'interceptor', 'guard', 'filter', 'pipe'],    name: 'Middleware Layer',    description: 'Request/response middleware and interceptors' },
  { patterns: ['client', 'integration', 'external', 'sdk', 'vendor', 'adapter'],
                                                                            name: 'External Services',   description: 'External service integrations, SDKs, and third-party adapters' },
  { patterns: ['worker', 'job', 'queue', 'cron', 'consumer', 'processor', 'scheduler', 'background'],
                                                                            name: 'Background Tasks',    description: 'Background workers, job processors, and scheduled tasks' },
  { patterns: ['util', 'helper', 'lib', 'common', 'shared'],               name: 'Utility Layer',       description: 'Shared utilities, helpers, and common libraries' },
  { patterns: ['test', 'spec', '__test__', '__spec__', '__tests__'],        name: 'Test Layer',          description: 'Test files and test utilities' },
  { patterns: ['config', 'setting', 'env'],                                 name: 'Configuration Layer', description: 'Application configuration and environment settings' },
];

function matchFileToLayer(filePath) {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const segments = norm.split('/');
  for (const { patterns, name } of LAYER_PATTERNS) {
    for (const seg of segments) {
      for (const p of patterns) {
        if (seg === p || seg === p + 's') return name;
      }
    }
  }
  return null;
}

function toLayerId(name) {
  return 'layer:' + name.toLowerCase().replace(/\s+/g, '-');
}

function detectLayersHeuristic(fileNodes) {
  const map = new Map(); // layerName → nodeIds[]
  for (const node of fileNodes) {
    const layerName = (node.file_path && matchFileToLayer(node.file_path)) || 'Core';
    if (!map.has(layerName)) map.set(layerName, []);
    map.get(layerName).push(node.id);
  }
  const layers = [];
  for (const [name, nodeIds] of map) {
    const pattern = LAYER_PATTERNS.find(p => p.name === name);
    layers.push({ id: toLayerId(name), name, description: pattern?.description ?? 'Core application files', nodeIds });
  }
  return layers;
}

// ── Anthropic API helpers (raw fetch — no SDK needed) ────────────────────────
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const ANTHROPIC_URL     = 'https://api.anthropic.com/v1/messages';
const MODEL             = 'claude-haiku-4-5-20251001'; // cheapest for bulk analysis

async function callClaude(systemPrompt, userPrompt, maxTokens = 1024) {
  const body = JSON.stringify({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });
  const headers = {
    'Content-Type': 'application/json',
    'x-api-key': ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
  };
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(ANTHROPIC_URL, { method: 'POST', headers, body });
      if (resp.ok) {
        const data = await resp.json();
        return data.content?.[0]?.text ?? '';
      }
      // Retry on 429 (rate limit) and 5xx; fail fast on 4xx
      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = parseInt(resp.headers.get('retry-after') || '0', 10);
        const backoff = retryAfter > 0 ? retryAfter * 1000 : Math.min(2 ** attempt * 1000, 8000);
        await new Promise(r => setTimeout(r, backoff));
        lastError = new Error(`Anthropic API ${resp.status} (attempt ${attempt + 1}/3)`);
        continue;
      }
      const text = await resp.text();
      throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 200)}`);
    } catch (e) {
      lastError = e;
      if (attempt === 2) break;
      await new Promise(r => setTimeout(r, Math.min(2 ** attempt * 1000, 4000)));
    }
  }
  throw lastError || new Error('Anthropic API failed after 3 attempts');
}

function parseJson(text) {
  try {
    const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    const src = fenceMatch ? fenceMatch[1] : text;
    const objMatch = src.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (objMatch) return JSON.parse(objMatch[0]);
  } catch {}
  return null;
}

// Per-file analysis prompt (ported from llm-analyzer.ts)
function buildFilePrompt(filePath, content, projectContext) {
  const truncated = content.length > 6000 ? content.slice(0, 6000) + '\n... (truncated)' : content;
  return `You are a code analysis assistant. Analyze the following source file and return a JSON object.

Project context: ${projectContext}

File: ${filePath}

\`\`\`
${truncated}
\`\`\`

Return a JSON object with exactly these fields:
- "fileSummary": A concise summary of what this file does (1-2 sentences).
- "tags": An array of 2-5 relevant tags (e.g., ["utility", "async", "api"]).
- "complexity": One of "simple", "moderate", or "complex".
- "functionSummaries": An object mapping each function/method name to a 1-sentence summary (top 5 only).
- "classSummaries": An object mapping each class name to a 1-sentence summary.

Respond ONLY with the JSON object, no additional text.`;
}

// Batch file analysis prompt (multiple files at once for efficiency)
function buildBatchPrompt(files, projectContext) {
  const fileBlocks = files.map(({ path, content }) => {
    const truncated = content.length > 2000 ? content.slice(0, 2000) + '\n...' : content;
    return `### ${path}\n\`\`\`\n${truncated}\n\`\`\``;
  }).join('\n\n');

  return `You are a code analysis assistant. Analyze the following source files and return a JSON object.

Project context: ${projectContext}

${fileBlocks}

Return a JSON object where each key is the exact file path and the value is:
- "fileSummary": 1-2 sentence summary of what the file does.
- "tags": 2-5 relevant tags.
- "complexity": "simple", "moderate", or "complex".
- "functionSummaries": object of function name → 1-sentence summary (top 5 per file).
- "classSummaries": object of class name → 1-sentence summary.

Respond ONLY with the JSON object mapping file paths to their analysis.`;
}

// Layer detection prompt (ported from layer-detector.ts)
function buildLayerPrompt(filePaths) {
  const list = filePaths.slice(0, 200).map(f => `  - ${f}`).join('\n');
  return `You are a software architecture analyst. Given these file paths, identify 3-8 logical architectural layers.

${list}

Return a JSON array where each element has:
- "name": Short layer name (e.g., "API", "Data", "UI")
- "description": What this layer does (1 sentence)
- "filePatterns": Path prefixes that belong to this layer (e.g., ["src/routes/", "src/controllers/"])

Every file should belong to exactly one layer. Respond ONLY with the JSON array.`;
}

// ── .understandignore support (ported from ignore-filter.ts) ────────────────
const DEFAULT_IGNORE_PATTERNS = [
  'node_modules/', '.git/', 'vendor/', 'venv/', '.venv/', '__pycache__/',
  'dist/', 'build/', 'out/', 'coverage/', '.next/', '.cache/', '.turbo/', 'target/', 'obj/',
  '*.lock', 'package-lock.json', 'yarn.lock', 'pnpm-lock.yaml',
  '*.png', '*.jpg', '*.jpeg', '*.gif', '*.svg', '*.ico', '*.woff', '*.woff2',
  '*.ttf', '*.eot', '*.mp3', '*.mp4', '*.pdf', '*.zip', '*.tar', '*.gz',
  '*.min.js', '*.min.css', '*.map', '*.generated.*',
  '.idea/', '.vscode/', '*.log',
];

function loadIgnorePatterns(dir) {
  const patterns = [...DEFAULT_IGNORE_PATTERNS];
  const locations = [
    join(dir, '.understand-anything', '.understandignore'),
    join(dir, '.understandignore'),
  ];
  for (const p of locations) {
    if (existsSync(p)) {
      try {
        const lines = readFileSync(p, 'utf-8').split('\n')
          .map(l => l.trim()).filter(l => l && !l.startsWith('#'));
        patterns.push(...lines);
      } catch {}
    }
  }
  return patterns;
}

function makeIgnoreMatcher(patterns) {
  return function isIgnored(filePath) {
    const norm = filePath.replace(/\\/g, '/');
    for (const pat of patterns) {
      if (pat.startsWith('!')) continue; // negation — skip for simplicity
      if (pat.endsWith('/')) {
        // directory pattern
        if (norm.includes('/' + pat.slice(0, -1) + '/') || norm.startsWith(pat)) return true;
      } else if (pat.startsWith('*.')) {
        // extension glob
        if (norm.endsWith(pat.slice(1))) return true;
      } else if (pat.includes('*')) {
        // simple wildcard — match anywhere in path
        const re = new RegExp('^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        if (re.test(norm) || re.test(norm.split('/').pop() || '')) return true;
      } else {
        // exact segment or prefix
        if (norm === pat || norm.includes('/' + pat) || norm.startsWith(pat)) return true;
      }
    }
    return false;
  };
}

const _ignorePatterns = loadIgnorePatterns(projectDir);
const isIgnoredByUser = makeIgnoreMatcher(_ignorePatterns);

// ── Incremental mode helpers (ported from staleness.ts) ──────────────────────
function getChangedFiles(dir, lastHash) {
  const files = new Set();
  function runGit(args) {
    try {
      const out = execFileSync('git', args, { cwd: dir, encoding: 'utf-8' });
      for (const line of out.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // `git status --porcelain` lines look like " M path/to/file" or "?? path"
        // Strip the leading status code if present
        const path = trimmed.length > 3 && trimmed[2] === ' ' ? trimmed.slice(3) : trimmed;
        files.add(path);
      }
    } catch { /* git not available or no diff */ }
  }
  // Committed changes since last run
  runGit(['diff', `${lastHash}..HEAD`, '--name-only']);
  // Uncommitted working tree changes (staged + unstaged + untracked)
  runGit(['status', '--porcelain']);
  return [...files];
}

function getCurrentCommitHash(dir) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
}

// ── Language detection (slim port of language-registry.ts) ──────────────────
const LANGUAGE_BY_EXT = {
  '.ts': 'TypeScript', '.tsx': 'TypeScript',
  '.js': 'JavaScript', '.jsx': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript',
  '.py': 'Python', '.pyi': 'Python',
  '.rs': 'Rust', '.go': 'Go',
  '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
  '.rb': 'Ruby', '.php': 'PHP', '.swift': 'Swift',
  '.c': 'C', '.h': 'C', '.cpp': 'C++', '.cc': 'C++', '.hpp': 'C++', '.hxx': 'C++',
  '.cs': 'C#', '.fs': 'F#',
  '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.lua': 'Lua', '.r': 'R', '.dart': 'Dart', '.ex': 'Elixir', '.exs': 'Elixir',
  '.sol': 'Solidity', '.zig': 'Zig', '.nim': 'Nim',
  '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS', '.vue': 'Vue', '.svelte': 'Svelte',
};

function detectLanguages(fileNodes) {
  const counts = new Map();
  for (const n of fileNodes) {
    if (!n.file_path) continue;
    const lastDot = n.file_path.lastIndexOf('.');
    if (lastDot === -1) continue;
    const ext = n.file_path.slice(lastDot).toLowerCase();
    const lang = LANGUAGE_BY_EXT[ext];
    if (lang) counts.set(lang, (counts.get(lang) || 0) + 1);
  }
  // Return languages with >=3 files, sorted by count desc
  return [...counts.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .map(([lang]) => lang);
}

// ── Framework detection (slim port of framework-registry.ts) ────────────────
const FRAMEWORK_SIGNATURES = [
  // [name, manifestFile, keywords[]]
  ['React',        'package.json',     ['"react"']],
  ['Next.js',      'package.json',     ['"next"']],
  ['Vue',          'package.json',     ['"vue"']],
  ['Svelte',       'package.json',     ['"svelte"']],
  ['Angular',      'package.json',     ['"@angular/core"']],
  ['Express',      'package.json',     ['"express"']],
  ['Fastify',      'package.json',     ['"fastify"']],
  ['NestJS',       'package.json',     ['"@nestjs/core"']],
  ['Vite',         'package.json',     ['"vite"']],
  ['Webpack',      'package.json',     ['"webpack"']],
  ['TypeScript',   'package.json',     ['"typescript"']],
  ['Anthropic SDK','package.json',     ['"@anthropic-ai/sdk"']],
  ['Django',       'requirements.txt', ['django']],
  ['Flask',        'requirements.txt', ['flask']],
  ['FastAPI',      'requirements.txt', ['fastapi']],
  ['Rails',        'Gemfile',          ['rails']],
  ['Spring Boot',  'pom.xml',          ['spring-boot']],
  ['Axum',         'Cargo.toml',       ['axum']],
  ['Actix',        'Cargo.toml',       ['actix-web']],
  ['Tokio',        'Cargo.toml',       ['tokio']],
  ['Gin',          'go.mod',           ['gin-gonic/gin']],
];

function findManifests(dir, manifestName, maxDepth = 4) {
  const fs = createRequire(import.meta.url)('node:fs');
  const results = [];
  function walk(d, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name.startsWith('.')) continue;
      const full = join(d, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.name === manifestName) results.push(full);
    }
  }
  walk(dir, 0);
  return results;
}

function detectFrameworks(dir) {
  const detected = [];
  const seen = new Set();
  // Cache manifest contents by name to avoid re-reading
  const manifestCache = new Map();
  for (const [name, manifest, keywords] of FRAMEWORK_SIGNATURES) {
    if (seen.has(name)) continue;
    let manifestPaths = manifestCache.get(manifest);
    if (!manifestPaths) {
      manifestPaths = findManifests(dir, manifest);
      manifestCache.set(manifest, manifestPaths);
    }
    for (const p of manifestPaths) {
      try {
        const content = readFileSync(p, 'utf-8').toLowerCase();
        if (keywords.some(k => content.includes(k.toLowerCase()))) {
          detected.push(name);
          seen.add(name);
          break;
        }
      } catch {}
    }
  }
  return detected;
}

// ── Onboarding guide builder (ported from onboard-builder.ts) ───────────────
function buildOnboardingGuide(graphJson) {
  const { project, nodes, layers, tour = [] } = graphJson;
  const lines = [];

  lines.push(`# ${project.name}`);
  lines.push('');
  if (project.description) {
    lines.push(`> ${project.description}`);
    lines.push('');
  }
  lines.push('| | |');
  lines.push('|---|---|');
  if (project.languages?.length) lines.push(`| **Languages** | ${project.languages.join(', ')} |`);
  if (project.frameworks?.length) lines.push(`| **Frameworks** | ${project.frameworks.join(', ')} |`);
  lines.push(`| **Components** | ${nodes.length} nodes |`);
  lines.push(`| **Last Analyzed** | ${project.analyzedAt} |`);
  lines.push('');

  if (layers.length > 0) {
    lines.push('## Architecture');
    lines.push('');
    lines.push('The project is organized into the following layers:');
    lines.push('');
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const layer of layers) {
      lines.push(`### ${layer.name}`);
      lines.push('');
      if (layer.description) { lines.push(layer.description); lines.push(''); }
      const members = (layer.nodeIds || []).map(id => nodeMap.get(id)?.name).filter(Boolean);
      if (members.length > 0) { lines.push(`Key components: ${members.slice(0, 8).join(', ')}`); lines.push(''); }
    }
  }

  if (tour.length > 0) {
    lines.push('## Getting Started');
    lines.push('');
    lines.push('Follow this guided tour to understand the codebase:');
    lines.push('');
    const nodeMap = new Map(nodes.map(n => [n.id, n]));
    for (const step of tour) {
      lines.push(`### ${step.order}. ${step.title}`);
      lines.push('');
      lines.push(step.description);
      lines.push('');
      const stepNodes = (step.nodeIds || []).map(id => nodeMap.get(id)).filter(Boolean);
      if (stepNodes.length > 0) {
        lines.push('**Files to look at:**');
        for (const node of stepNodes) {
          if (node.filePath) lines.push(`- \`${node.filePath}\` — ${node.summary}`);
        }
        lines.push('');
      }
    }
  }

  const FILE_MAP_LIMIT = 50;
  const HOTSPOT_LIMIT = 20;

  const fileNodes = nodes.filter(n => n.type === 'file' && n.filePath && n.summary);
  if (fileNodes.length > 0) {
    lines.push('## File Map');
    lines.push('');
    if (fileNodes.length > FILE_MAP_LIMIT) {
      lines.push(`Showing ${FILE_MAP_LIMIT} of ${fileNodes.length} analyzed files. See \`.understand/knowledge-graph.json\` for the full list.`);
      lines.push('');
    }
    lines.push('| File | Purpose | Complexity |');
    lines.push('|------|---------|------------|');
    for (const node of fileNodes.slice(0, FILE_MAP_LIMIT)) {
      const summary = (node.summary || '').replace(/\|/g, '\\|');
      lines.push(`| \`${node.filePath}\` | ${summary} | ${node.complexity || 'moderate'} |`);
    }
    lines.push('');
  }

  const complexNodes = nodes.filter(n => n.complexity === 'complex');
  if (complexNodes.length > 0) {
    lines.push('## Complexity Hotspots');
    lines.push('');
    lines.push('These components are the most complex and deserve extra attention:');
    if (complexNodes.length > HOTSPOT_LIMIT) {
      lines.push('');
      lines.push(`Showing top ${HOTSPOT_LIMIT} of ${complexNodes.length} complex components.`);
    }
    lines.push('');
    for (const node of complexNodes.slice(0, HOTSPOT_LIMIT)) {
      lines.push(`- **${node.name}** (${node.type}): ${node.summary || ''}`);
    }
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push(`*Generated by [monomind](https://github.com/nokhodian/monomind) from knowledge graph v${graphJson.version}*`);
  lines.push('');

  return lines.join('\n');
}

// ── File reading with graceful skip ─────────────────────────────────────────
function readFileSafe(absPath) {
  try {
    const content = readFileSync(absPath, 'utf-8');
    return content;
  } catch {
    return null;
  }
}

const SKIP_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp',
  '.pdf', '.zip', '.tar', '.gz', '.wasm', '.map',
  '.lock', '.lockb', '.db', '.sqlite', '.bin', '.exe',
]);
function shouldAnalyze(filePath) {
  if (!filePath) return false;
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  if (SKIP_EXTENSIONS.has(ext)) return false;
  if (isIgnoredByUser(filePath)) return false;
  return true;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('[understand] Starting semantic enrichment for', projectDir);

  if (!existsSync(dbPathArg)) {
    console.error('[understand] monograph.db not found at', dbPathArg);
    console.error('[understand] Build the graph first: npx monomind monograph build');
    process.exit(1);
  }

  const mg = resolveMonograph();
  if (!mg) {
    console.error('[understand] Cannot find @monoes/monograph. Run: npm install @monoes/monograph');
    process.exit(1);
  }

  // Retry openDb against SQLite BUSY when monograph is building in the background
  let db;
  for (let attempt = 0; attempt < 5; attempt++) {
    try { db = mg.openDb(dbPathArg); break; }
    catch (e) {
      if (attempt === 4) throw e;
      const msg = String(e?.message || e);
      if (!/busy|locked/i.test(msg)) throw e;
      console.log(`[understand] monograph.db busy, retrying in ${(attempt + 1) * 2}s...`);
      await new Promise(r => setTimeout(r, (attempt + 1) * 2000));
    }
  }

  // Ensure properties column exists
  try { db.prepare(`ALTER TABLE nodes ADD COLUMN properties TEXT`).run(); } catch {}
  try { db.prepare(`CREATE TABLE IF NOT EXISTS communities (id INTEGER PRIMARY KEY, label TEXT, size INTEGER NOT NULL DEFAULT 0, cohesion_score REAL NOT NULL DEFAULT 0.0)`).run(); } catch {}

  // ── Load all file nodes ──────────────────────────────────────────────────
  let fileNodes = db.prepare(`SELECT id, name, file_path, properties FROM nodes WHERE label = 'File' AND file_path IS NOT NULL`).all();
  console.log(`[understand] Found ${fileNodes.length} file nodes in DB`);

  // ── Layers-only mode ─────────────────────────────────────────────────────
  if (layersOnly) {
    console.log('[understand] Layers-only mode — skipping per-file analysis');
    await detectAndWriteLayers(db, fileNodes, noLlm, dryRun);
    mg.closeDb(db);
    console.log('[understand] Done (layers-only)');
    return;
  }

  // ── Incremental mode: only re-analyze changed files ─────────────────────
  let changedFileSet = null; // null means "analyze all"
  if (incremental) {
    let lastHash = '';
    try {
      const row = db.prepare(`SELECT value FROM index_meta WHERE key = 'ua_last_commit'`).get();
      lastHash = row?.value || '';
    } catch {}
    if (lastHash) {
      const changed = getChangedFiles(projectDir, lastHash);
      if (changed.length > 0) {
        changedFileSet = new Set(changed);
        console.log(`[understand] Incremental mode: ${changed.length} files changed since ${lastHash.slice(0, 8)}`);
      } else {
        console.log('[understand] Incremental mode: no changes detected since last run — skipping analysis');
        mg.closeDb(db);
        return;
      }
    } else {
      console.log('[understand] Incremental mode: no previous commit hash found — running full analysis');
    }
  }

  // ── Filter files that need analysis ─────────────────────────────────────
  const toAnalyze = fileNodes.filter(n => {
    if (!shouldAnalyze(n.file_path)) return false;
    if (changedFileSet) {
      // Match by relative or absolute path
      const rel = n.file_path.startsWith('/') ? relative(projectDir, n.file_path) : n.file_path;
      return changedFileSet.has(rel) || changedFileSet.has(n.file_path);
    }
    return true;
  });
  const limit = maxFiles > 0 ? Math.min(maxFiles, toAnalyze.length) : toAnalyze.length;
  const batch = toAnalyze.slice(0, limit);
  console.log(`[understand] Analyzing ${batch.length} files (${toAnalyze.length - batch.length} skipped/already enriched)`);

  if (!ANTHROPIC_API_KEY && !noLlm) {
    console.warn('[understand] ANTHROPIC_API_KEY not set — falling back to --no-llm heuristic mode');
    // Fall through to heuristic only
  }

  const useLlm = !noLlm && !!ANTHROPIC_API_KEY;

  // ── Get project context for better prompts ────────────────────────────────
  let projectContext = `Project directory: ${basename(projectDir)}`;
  try {
    const pkgPath = join(projectDir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      projectContext = `${pkg.name || basename(projectDir)}: ${pkg.description || ''}`.trim();
    }
  } catch {}

  // ── Per-file LLM analysis ────────────────────────────────────────────────
  const analysisMap = {}; // file_path → { fileSummary, tags, complexity, functionSummaries, classSummaries }

  if (useLlm && batch.length > 0) {
    const system = 'You are an expert code analysis assistant. Always respond with valid JSON only.';
    const chunks = [];
    for (let i = 0; i < batch.length; i += batchSize) chunks.push(batch.slice(i, i + batchSize));

    let done = 0;
    for (const chunk of chunks) {
      // Read file contents
      const files = chunk
        .map(n => {
          const absPath = n.file_path.startsWith('/') ? n.file_path : join(projectDir, n.file_path);
          const content = readFileSafe(absPath);
          return content ? { path: n.file_path, content, nodeId: n.id } : null;
        })
        .filter(Boolean);

      if (files.length === 0) { done += chunk.length; continue; }

      process.stdout.write(`\r[understand] Analyzing files ${done + 1}–${Math.min(done + files.length, batch.length)} / ${batch.length}...`);

      try {
        let text;
        if (files.length === 1) {
          text = await callClaude(system, buildFilePrompt(files[0].path, files[0].content, projectContext));
          const parsed = parseJson(text);
          if (parsed) analysisMap[files[0].path] = parsed;
        } else {
          text = await callClaude(system, buildBatchPrompt(files, projectContext), 2048);
          const parsed = parseJson(text);
          if (parsed && typeof parsed === 'object') {
            for (const [fp, analysis] of Object.entries(parsed)) {
              if (analysis && typeof analysis === 'object') analysisMap[fp] = analysis;
            }
          }
        }
      } catch (e) {
        console.warn(`\n[understand] API error for batch at ${done}: ${e.message}`);
      }

      done += files.length;
      // Polite rate limiting
      if (chunks.indexOf(chunk) < chunks.length - 1) await new Promise(r => setTimeout(r, 300));
    }
    console.log(`\n[understand] LLM analysis complete: ${Object.keys(analysisMap).length} files analyzed`);
  }

  // ── Write analysis back to DB ─────────────────────────────────────────────
  const updateNode = db.prepare(`UPDATE nodes SET properties = ? WHERE id = ?`);
  let written = 0;

  if (!dryRun) {
    const tx = db.transaction(() => {
      for (const node of batch) {
        const existing = node.properties ? (() => { try { return JSON.parse(node.properties); } catch { return {}; } })() : {};
        const llmData  = analysisMap[node.file_path] || {};
        const merged = {
          ...existing,
          ...(llmData.fileSummary   ? { summary:     llmData.fileSummary }   : {}),
          ...(llmData.tags          ? { tags:         llmData.tags }          : {}),
          ...(llmData.complexity    ? { complexity:   llmData.complexity }    : {}),
          ...(llmData.languageNotes ? { languageNotes: llmData.languageNotes } : {}),
          ...(llmData.functionSummaries ? { functionSummaries: llmData.functionSummaries } : {}),
          ...(llmData.classSummaries    ? { classSummaries:    llmData.classSummaries }    : {}),
          ua_analyzed_at: new Date().toISOString(),
        };
        updateNode.run(JSON.stringify(merged), node.id);
        written++;
      }
    });
    tx();
    console.log(`[understand] Wrote enrichment data to ${written} nodes`);
  } else {
    console.log(`[understand] DRY RUN — would update ${batch.length} nodes`);
  }

  // ── Layer detection ──────────────────────────────────────────────────────
  const layers = await detectAndWriteLayers(db, fileNodes, noLlm || !useLlm, dryRun, projectDir);

  // ── Emit graph.json (for compatibility with ua-import.mjs) ──────────────
  const graphJson = buildGraphJson(projectDir, fileNodes, analysisMap, layers);
  const outputDir = dirname(outputArg);
  if (!dryRun) {
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(outputArg, JSON.stringify(graphJson, null, 2), 'utf-8');
    console.log(`[understand] graph.json written to ${outputArg}`);
  }

  // ── Rebuild FTS ──────────────────────────────────────────────────────────
  if (!dryRun) {
    try {
      db.prepare(`INSERT INTO nodes_fts(nodes_fts) VALUES('rebuild')`).run();
      console.log('[understand] FTS index rebuilt');
    } catch {}
  }

  // ── Update index_meta ────────────────────────────────────────────────────
  if (!dryRun) {
    const upsertMeta = db.prepare(
      `INSERT INTO index_meta (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value=excluded.value`
    );
    upsertMeta.run('ua_analyzed_at', new Date().toISOString());
    const currentHash = getCurrentCommitHash(projectDir);
    if (currentHash) upsertMeta.run('ua_last_commit', currentHash);
  }

  mg.closeDb(db);

  // ── Onboarding guide ─────────────────────────────────────────────────────
  let onboardWritten = false;
  if (onboard && !dryRun) {
    const guide = buildOnboardingGuide(graphJson);
    writeFileSync(onboardOut, guide, 'utf-8');
    onboardWritten = true;
    console.log(`[understand] Onboarding guide written to ${relative(CWD, onboardOut)}`);
  }

  // ── Final report ─────────────────────────────────────────────────────────
  const title = dryRun
    ? '║  /monomind:understand — DRY RUN (no writes)       ║'
    : '║  /monomind:understand — Enrichment Complete       ║';
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(title);
  console.log('╠══════════════════════════════════════════════════╣');
  console.log(`║  DB:              ${relative(CWD, dbPathArg).padEnd(31)}║`);
  console.log(`║  Nodes enriched:  ${String(written).padEnd(31)}║`);
  console.log(`║  Communities:     ${String(layers.length).padEnd(31)}║`);
  console.log(`║  graph.json:      ${relative(CWD, outputArg).padEnd(31)}║`);
  if (onboardWritten) {
    console.log(`║  ONBOARDING.md:   ${relative(CWD, onboardOut).padEnd(31)}║`);
  }
  console.log('╚══════════════════════════════════════════════════╝');
}

// ── Detect layers and write communities to DB ────────────────────────────────
async function detectAndWriteLayers(db, fileNodes, forceHeuristic, dryRun, dir) {
  let layers;

  if (!forceHeuristic && ANTHROPIC_API_KEY) {
    console.log('[understand] Detecting architectural layers via LLM...');
    const filePaths = fileNodes.map(n => n.file_path).filter(Boolean);
    try {
      const system = 'You are a software architecture expert. Respond with valid JSON only.';
      const text   = await callClaude(system, buildLayerPrompt(filePaths), 1024);
      const parsed = parseJson(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        layers = applyLlmLayers(fileNodes, parsed);
        console.log(`[understand] LLM detected ${layers.length} layers`);
      }
    } catch (e) {
      console.warn('[understand] LLM layer detection failed, falling back to heuristic:', e.message);
    }
  }

  if (!layers) {
    layers = detectLayersHeuristic(fileNodes);
    console.log(`[understand] Heuristic layer detection: ${layers.length} layers`);
  }

  if (!dryRun) {
    let communityIdx = 1000;
    const upsertCommunity = db.prepare(
      `INSERT INTO communities (id, label, size, cohesion_score)
       VALUES (?, ?, ?, 0.8)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, size=excluded.size`
    );
    const updateNodeCommunity = db.prepare(`UPDATE nodes SET community_id = ? WHERE id = ?`);

    const tx = db.transaction(() => {
      for (const layer of layers) {
        upsertCommunity.run(communityIdx, layer.name, layer.nodeIds.length);
        for (const nodeId of layer.nodeIds) {
          updateNodeCommunity.run(communityIdx, nodeId);
        }
        communityIdx++;
      }
    });
    tx();
    console.log(`[understand] Wrote ${layers.length} communities to DB`);
  }

  return layers;
}

// Apply LLM-suggested layer patterns to file nodes (ported from applyLLMLayers)
function applyLlmLayers(fileNodes, llmLayers) {
  const map = new Map();
  for (const l of llmLayers) map.set(l.name, []);

  for (const node of fileNodes) {
    if (!node.file_path) {
      const other = map.get('Other') ?? [];
      other.push(node.id);
      map.set('Other', other);
      continue;
    }
    const norm = node.file_path.replace(/\\/g, '/');
    let assigned = false;
    for (const l of llmLayers) {
      for (const pattern of (l.filePatterns || [])) {
        if (norm.startsWith(pattern) || norm.includes('/' + pattern)) {
          map.get(l.name).push(node.id);
          assigned = true;
          break;
        }
      }
      if (assigned) break;
    }
    if (!assigned) {
      const other = map.get('Other') ?? [];
      other.push(node.id);
      map.set('Other', other);
    }
  }

  const layers = [];
  for (const [name, nodeIds] of map) {
    if (nodeIds.length === 0) continue;
    const l = llmLayers.find(x => x.name === name);
    layers.push({ id: toLayerId(name), name, description: l?.description ?? 'Uncategorized', nodeIds });
  }
  return layers;
}

// Build a KnowledgeGraph-compatible graph.json for ua-import compatibility
function buildGraphJson(dir, fileNodes, analysisMap, layers) {
  const projectName = basename(dir);
  const nodes = fileNodes.map(n => {
    const a = analysisMap[n.file_path] || {};
    return {
      id: 'file:' + (n.file_path || n.name),
      type: 'file',
      name: n.name,
      filePath: n.file_path,
      summary: a.fileSummary || '',
      tags: a.tags || [],
      complexity: a.complexity || 'moderate',
    };
  });

  // Project metadata
  let description = '';
  try {
    const pkgPath = join(dir, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      description = pkg.description || '';
    }
  } catch {}

  return {
    version: '2.7.0',
    kind: 'codebase',
    project: {
      name: projectName,
      languages: detectLanguages(fileNodes),
      frameworks: detectFrameworks(dir),
      description,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: getCurrentCommitHash(dir),
    },
    nodes,
    edges: [],
    layers: layers.map(l => ({ id: l.id, name: l.name, description: l.description, nodeIds: l.nodeIds })),
    tour: [],
  };
}

main().catch(e => {
  console.error('[understand] Fatal error:', e.message);
  process.exit(1);
});
