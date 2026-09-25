#!/usr/bin/env node
'use strict';
/**
 * The agent registry (.monomind/registry.json) — ONE implementation shared by
 * the CLI (src/agents/registry-builder.ts and registry-freshness.ts load this
 * file) and the SessionStart hook (handlers/pick-core.cjs), so an agent added
 * to ~/.claude/agents or .claude/agents is indexed at the next session start
 * without running the CLI, and both sides parse frontmatter the same way.
 *
 * Roots, in precedence order (the first definition of a slug wins):
 *   extra    $MONOMIND_EXTRA_AGENT_PATHS (':'-separated), else a sibling
 *            ../agency-agents directory — canonical, wins over the project
 *   project  <root>/.claude/agents
 *   user     ~/.claude/agents — Claude Code loads these in every project, so
 *            they are valid Task subagent_types. As in Claude Code, a project
 *            (or extra) agent wins: a user agent whose slug or frontmatter
 *            `name` is already defined is left out (listed under `shadowed`).
 *
 * User entries record `~/.claude/agents/...` as filePath, never the absolute
 * home path. The registry is rebuilt when missing or older than any agent file
 * in those roots (an mtime scan, no parsing) or this builder.
 *
 * Usage:  node .claude/helpers/agent-registry.cjs [projectRoot]
 */

var fs = require('fs');
var os = require('os');
var path = require('path');

/** Directories to skip during the scan. `reengineer-squad` is a repo-only
 *  squad the package does not ship, and its `tester` would shadow the core
 *  tester. */
var SKIP_DIRS = new Set(['schemas', 'ephemeral', 'reengineer-squad']);
var MAX_AGENT_BYTES = 512 * 1024;
var USER_LABEL = '~/.claude/agents';

function homeDir(opts) {
  return (opts && opts.home) || os.homedir();
}

/** Every `.md` under `root` (recursively), skipping SKIP_DIRS and `._` forks. */
function collectMdFiles(root) {
  var results = [];
  var entries;
  try {
    entries = fs.readdirSync(root);
  } catch (e) {
    return results;
  }
  for (var i = 0; i < entries.length; i++) {
    var entry = entries[i];
    var full = path.join(root, entry);
    var stat;
    try {
      stat = fs.statSync(full);
    } catch (e) {
      continue;
    }
    if (stat.isDirectory()) {
      if (SKIP_DIRS.has(entry)) continue;
      results.push.apply(results, collectMdFiles(full));
    } else if (stat.isFile() && path.extname(entry) === '.md' && !entry.startsWith('._')) {
      results.push(full);
    }
  }
  return results;
}

function unquote(v) {
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1);
  return v;
}

/**
 * Nested YAML list items under a key whose value was empty
 * (`triggers:\n  - pattern: ...`): a string array when every item is a plain
 * scalar, an array of objects when items hold `key: value` pairs, null when
 * there are no list items.
 */
function parseNestedYamlList(lines, startIdx, parentIndent) {
  var objects = [];
  var simpleItems = [];
  var current = null;
  var consumed = 0;
  var hasObjects = false;
  for (var i = startIdx; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      consumed++;
      continue;
    }
    var indent = line.length - line.trimStart().length;
    if (indent <= parentIndent) break;
    if (trimmed.startsWith('- ')) {
      var itemContent = trimmed.slice(2);
      var colon = itemContent.indexOf(': ');
      if (colon !== -1) {
        hasObjects = true;
        current = {};
        current[itemContent.slice(0, colon).trim()] = unquote(itemContent.slice(colon + 2).trim());
        objects.push(current);
      } else {
        simpleItems.push(unquote(itemContent.trim()));
      }
      consumed++;
    } else if (current && hasObjects) {
      var c = trimmed.indexOf(': ');
      if (c !== -1) current[trimmed.slice(0, c).trim()] = unquote(trimmed.slice(c + 2).trim());
      consumed++;
    } else {
      break;
    }
  }
  if (hasObjects && objects.length > 0) return { value: objects, consumed: consumed };
  if (simpleItems.length > 0) return { value: simpleItems, consumed: consumed };
  return { value: null, consumed: consumed };
}

/** The leading `---` frontmatter block as a flat key → value map (scalars,
 *  booleans, `[a, b]` and nested `- ` lists, `|`/`>` block scalars). */
function parseFrontmatter(content) {
  var match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!match) return {};
  var result = {};
  var lines = match[1].split('\n');
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    var colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    var key = trimmed.slice(0, colonIdx).trim();
    var value = trimmed.slice(colonIdx + 1).trim();

    var blockScalar = /^([|>])[+-]?$/.exec(value);
    if (blockScalar) {
      var blockIndent = line.length - line.trimStart().length;
      var body = [];
      while (i + 1 < lines.length) {
        var next = lines[i + 1];
        if (next.trim() && next.length - next.trimStart().length <= blockIndent) break;
        body.push(next.trim());
        i++;
      }
      result[key] = body.join(blockScalar[1] === '|' ? '\n' : ' ').trim();
      continue;
    }

    if (value === '') {
      var nested = parseNestedYamlList(lines, i + 1, line.length - line.trimStart().length);
      if (nested.value !== null) {
        result[key] = nested.value;
        i += nested.consumed;
        continue;
      }
    }

    if (value.startsWith('[') && value.endsWith(']')) {
      value = value
        .slice(1, -1)
        .split(',')
        .map(function (s) { return s.trim().replace(/^["']|["']$/g, ''); })
        .filter(Boolean);
    } else if (value === 'true') value = true;
    else if (value === 'false') value = false;
    else value = unquote(value);
    result[key] = value;
  }
  return result;
}

/** The first argument that is not undefined/null (a `??` chain). */
function first() {
  for (var i = 0; i < arguments.length; i++) if (arguments[i] !== undefined && arguments[i] !== null) return arguments[i];
  return undefined;
}

function toStringArray(val) {
  if (Array.isArray(val)) return val.map(String);
  if (typeof val === 'string' && val.length > 0) return [val];
  return [];
}

function parseTriggers(val) {
  if (!val) return [];
  var arr = Array.isArray(val) ? val : [val];
  return arr.map(function (t) {
    if (typeof t === 'object' && t !== null && 'pattern' in t) {
      return { pattern: String(t.pattern), mode: String(first(t.mode, 'glob')) };
    }
    return { pattern: String(t), mode: 'glob' };
  });
}

function slugFromFilename(file) {
  return path.basename(file, path.extname(file))
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '');
}

function categoryFromPath(file, root) {
  var parts = path.relative(root, file).split(path.sep);
  return parts.length > 1 ? parts[0] : 'default';
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (e) { return false; }
}

/**
 * The agent roots for project `cwd`, in precedence order: extras, the
 * project's .claude/agents, then ~/.claude/agents (opts.user === false leaves
 * it out; opts.home overrides the home directory). When cwd is the home
 * directory the two .claude/agents are one directory, listed once as `user`.
 */
function computeAgentRoots(cwd, opts) {
  var env = (opts && opts.env) || process.env;
  var extras = env.MONOMIND_EXTRA_AGENT_PATHS ? env.MONOMIND_EXTRA_AGENT_PATHS.split(':').filter(Boolean) : [];
  var sibling = path.join(cwd, '..', 'agency-agents');
  if (extras.length === 0 && isDir(sibling)) extras.push(sibling);
  var roots = extras.map(function (dir) { return { dir: dir, origin: 'extra' }; });
  var projectDir = path.join(cwd, '.claude', 'agents');
  var userDir = path.join(homeDir(opts), '.claude', 'agents');
  var withUser = !(opts && opts.user === false);
  if (!withUser || path.resolve(projectDir) !== path.resolve(userDir)) roots.push({ dir: projectDir, origin: 'project' });
  if (withUser) roots.push({ dir: userDir, origin: 'user', label: USER_LABEL });
  return roots;
}

/** A root given as a plain path is a project-local definition directory. */
function asRoot(r) {
  return typeof r === 'string' ? { dir: r, origin: 'project' } : r;
}

/**
 * Builds the registry from `roots` (first root wins a slug; a `user` agent
 * also loses to any earlier agent with the same frontmatter `name` or slug),
 * writing it to `outputPath` when given. opts.base: the directory project and
 * extra filePaths are relative to (default cwd).
 */
function buildUnifiedRegistry(roots, outputPath, opts) {
  var now = new Date().toISOString();
  var base = (opts && opts.base) || process.cwd();
  var seen = new Map();
  var names = new Set();
  var dupes = new Map();
  var shadowed = [];
  var counts = { project: 0, user: 0, extra: 0 };
  (roots || []).map(asRoot).forEach(function (root) {
    var files = collectMdFiles(root.dir);
    files.forEach(function (file) {
      var content;
      try {
        if (fs.statSync(file).size > MAX_AGENT_BYTES) return;
        content = fs.readFileSync(file, 'utf-8');
      } catch (e) {
        return;
      }
      var fm = parseFrontmatter(content);
      var slug = (typeof fm.slug === 'string' && fm.slug) || slugFromFilename(file);
      var name = (typeof fm.name === 'string' && fm.name) || slug;
      var filePath = root.label
        ? root.label + '/' + path.relative(root.dir, file).split(path.sep).join('/')
        : path.isAbsolute(file) ? path.relative(base, file) : file;
      var prior = seen.get(slug);
      if (root.origin === 'user' && (prior ? prior.origin !== 'user' : names.has(name) || names.has(slug))) {
        shadowed.push({ slug: slug, name: name, filePath: filePath });
        return;
      }
      if (prior) {
        var d = dupes.get(slug) || { slug: slug, kept: prior.filePath, dropped: [] };
        d.dropped.push(filePath);
        dupes.set(slug, d);
        return;
      }
      var str = function (v) { return typeof v === 'string' ? v : undefined; };
      seen.set(slug, {
        slug: slug,
        name: name,
        version: str(fm.version) || '0.0.0',
        category: str(fm.category) || categoryFromPath(file, root.dir),
        description: str(fm.description) || '',
        whenToUse: str(first(fm.when_to_use, fm.whenToUse)),
        tags: toStringArray(fm.tags),
        vibe: str(fm.vibe),
        // A `capability:` block is read flattened, so its `expertise:` list lands top-level
        capabilities: toStringArray(first(fm.capabilities, fm.expertise)),
        taskTypes: toStringArray(first(fm.taskTypes, fm['task-types'], fm.task_types)),
        tools: toStringArray(fm.tools),
        triggers: parseTriggers(fm.triggers),
        deprecated: fm.deprecated === true,
        deprecatedBy: str(fm.deprecatedBy),
        dependencies: toStringArray(fm.dependencies),
        origin: root.origin,
        filePath: filePath,
        registeredAt: now,
        lastUpdated: now,
      });
      names.add(name);
      names.add(slug);
      counts[root.origin] = (counts[root.origin] || 0) + 1;
    });
  });
  var agents = Array.from(seen.values());
  var registry = {
    version: '1.0.0',
    generatedAt: now,
    totalAgents: agents.length,
    counts: counts,
    agents: agents,
    duplicates: Array.from(dupes.values()),
    shadowed: shadowed,
  };
  if (outputPath) writeRegistryFile(outputPath, registry);
  return registry;
}

function agentCountOnDisk(file) {
  try {
    var reg = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return reg && Array.isArray(reg.agents) ? reg.agents.length : 0;
  } catch (e) {
    return 0;
  }
}

/** Writes `registry` atomically — except an empty registry never replaces a
 *  non-empty one. Returns whether the file was written. */
function writeRegistryFile(file, registry) {
  if (registry.agents.length === 0 && agentCountOnDisk(file) > 0) return false;
  var tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), 'utf-8');
  fs.renameSync(tmp, file);
  return true;
}

/** Newest mtime (ms) of any agent `.md` under `dirs`; directories count too,
 *  so a deleted file also marks the registry stale. 0 when there are none. */
function newestAgentMtime(dirs) {
  var newest = 0;
  function walk(dir) {
    var entries;
    try {
      newest = Math.max(newest, fs.statSync(dir).mtimeMs);
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    entries.forEach(function (e) {
      var full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.isFile() && path.extname(e.name) === '.md') {
        try { newest = Math.max(newest, fs.statSync(full).mtimeMs); } catch (err) { /* vanished */ }
      }
    });
  }
  (dirs || []).forEach(function (d) { walk(typeof d === 'string' ? d : d.dir); });
  return newest;
}

function registryPath(root) {
  return path.join(root, '.monomind', 'registry.json');
}

function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; }
}

/** True when `root`'s registry is missing or older than an agent definition
 *  in any root (project, user, extra) or than this builder. */
function isStale(root, opts) {
  var at = mtime(registryPath(root));
  if (at === 0) return true;
  return Math.max(newestAgentMtime(computeAgentRoots(root, opts)), mtime(__filename)) > at;
}

/** Rebuilds `root`'s registry when stale; the built registry, or null when it
 *  was fresh or the build failed. Never throws. */
function ensure(root, opts) {
  try {
    if (!isStale(root, opts)) return null;
    fs.mkdirSync(path.join(root, '.monomind'), { recursive: true });
    return buildUnifiedRegistry(computeAgentRoots(root, opts), registryPath(root), { base: root });
  } catch (e) {
    return null;
  }
}

/**
 * The nearest directory at or above `cwd` holding `.claude/agents` or
 * `.monomind`. The walk stops at the git root (inclusive) and never returns
 * the home directory itself, whose ~/.monomind is the user's global state.
 * Null when no project is found.
 */
function findProjectRoot(cwd, home) {
  var stopAt = path.resolve(home || os.homedir());
  var dir = path.resolve(cwd);
  for (;;) {
    if (dir === stopAt) return null;
    if (fs.existsSync(path.join(dir, '.claude', 'agents')) || fs.existsSync(path.join(dir, '.monomind'))) return dir;
    if (fs.existsSync(path.join(dir, '.git'))) return null;
    var parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function main() {
  var root = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || findProjectRoot(process.cwd());
  if (!root) {
    process.stderr.write('registry.json: no project found at or above ' + process.cwd() + '; nothing written\n');
    return;
  }
  fs.mkdirSync(path.join(root, '.monomind'), { recursive: true });
  var reg = buildUnifiedRegistry(computeAgentRoots(root), registryPath(root), { base: root });
  process.stdout.write('registry.json: ' + reg.totalAgents + ' agents (' + reg.counts.user + ' from ' + USER_LABEL + ')\n');
}

if (require.main === module) main();

module.exports = {
  USER_LABEL: USER_LABEL,
  parseFrontmatter: parseFrontmatter,
  computeAgentRoots: computeAgentRoots,
  buildUnifiedRegistry: buildUnifiedRegistry,
  writeRegistryFile: writeRegistryFile,
  newestAgentMtime: newestAgentMtime,
  registryPath: registryPath,
  isStale: isStale,
  ensure: ensure,
  findProjectRoot: findProjectRoot,
};
