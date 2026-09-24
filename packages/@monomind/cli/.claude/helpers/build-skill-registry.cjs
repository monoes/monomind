#!/usr/bin/env node
'use strict';
/**
 * skill-registry.json generator
 *
 * Scans the PROJECT-LOCAL skill/command trees and regenerates
 * .claude/helpers/skill-registry.json, which router.cjs's matchSkills()
 * reads to suggest a skill for a routed task.
 *
 * Why this exists: the registry was previously hand-maintained and rotted
 * badly — 28 of 53 entries pointed at skills that had been renamed
 * (lancedb-* -> agentdb-*, bare names -> v3-* prefixes, github:x -> github-x)
 * or deleted outright, while its own _meta claimed router.cjs read it (it
 * didn't — router.cjs had a separate hardcoded 6-entry list, one of which,
 * /graphify, was itself a phantom). Generating from the live tree is the only
 * way this file stays true.
 *
 * Scope: the PROJECT's own trees (.claude/commands, .claude/skills), the
 * user's ~/.claude/skills (source 'user'; project wins a name clash), and the
 * Org skill library (`orgSkills`, via org-skill-index.cjs). The file is
 * generated per machine (init, upgrade, SessionStart, `monomind pick`) and is
 * never committed — a shipped snapshot listed skills a project did not have.
 * README/overview/reference docs, `_`-prefixed includes and helper-only
 * skills (HELPER_ONLY, or frontmatter `type: helper`) are not entries.
 * Frontmatter `pick: low` marks an admin/meta entry (org management pages,
 * examples, the picker itself): it stays in the index, recorded as
 * `pick: 'low'`, and the pickers rank it below equally matching entries so
 * generic task words ("review", "settings") do not surface it.
 *
 * Usage:  node .claude/helpers/build-skill-registry.cjs [projectRoot]
 */

var fs = require('fs');
var os = require('os');
var path = require('path');
var orgIndex = require('./org-skill-index.cjs');

/** Protocol pieces other skills include; never invoked on their own. */
var HELPER_ONLY = new Set([
  'mastermind-agent-select', 'mastermind-delegation', 'mastermind-intake',
  'mastermind-protocol', 'mastermind-repeat', '_repeat', '_taskfile',
]);
/** Documentation pages that live beside commands but are not commands. */
var DOC_NAMES = new Set(['readme', 'overview', 'reference', 'references']);

// Words that carry no routing signal — dropped from derived keywords.
var STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'for', 'nor', 'so', 'yet', 'of', 'to',
  'in', 'on', 'at', 'by', 'from', 'with', 'without', 'into', 'onto', 'up',
  'down', 'out', 'off', 'over', 'under', 'again', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'any', 'both', 'each', 'few',
  'more', 'most', 'other', 'some', 'such', 'only', 'own', 'same', 'than',
  'too', 'very', 'can', 'will', 'just', 'should', 'now', 'use', 'used',
  'using', 'uses', 'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
  'did', 'you', 'your', 'they', 'them', 'their', 'not', 'no', 'if', 'else',
  'via', 'per', 'across', 'before', 'after', 'while', 'during', 'about',
  'every', 'also', 'one', 'two', 'new', 'full', 'run', 'runs', 'running',
  'never', 'always', 'must', 'need', 'needs', 'want', 'wants', 'want',
]);

var MAX_KEYWORDS = 150;

/** Parse a leading `---` YAML-ish frontmatter block. Handles `key: value`,
 *  quoted values, and `key: |` block scalars (used by several agent files). */
function readFrontmatter(text) {
  var out = {};
  var m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return out;
  var lines = m[1].split(/\r?\n/);
  var pendingKey = null;
  var blockLines = [];
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (pendingKey) {
      // Block scalar continues while lines are indented (or blank).
      if (/^\s+\S/.test(line) || line.trim() === '') {
        blockLines.push(line.trim());
        continue;
      }
      out[pendingKey] = blockLines.join(' ').trim();
      pendingKey = null;
      blockLines = [];
    }
    var kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    var key = kv[1];
    var val = kv[2].trim();
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      pendingKey = key;
      blockLines = [];
      continue;
    }
    // Strip surrounding quotes
    if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
        (val.startsWith("'") && val.endsWith("'") && val.length > 1)) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  if (pendingKey) out[pendingKey] = blockLines.join(' ').trim();
  return out;
}

/** Many commands in this repo carry their summary in a leading HTML comment
 *  instead of frontmatter (e.g. `<!-- Autonomous research -> build loop -->`).
 *  Falls back to that when frontmatter has no description. */
function readLeadingComment(text) {
  var m = /^\s*<!--\s*([\s\S]*?)\s*-->/.exec(text);
  if (!m) return '';
  var val = m[1].replace(/\s+/g, ' ').trim();
  if ((val.startsWith('"') && val.endsWith('"') && val.length > 1) ||
      (val.startsWith("'") && val.endsWith("'") && val.length > 1)) {
    val = val.slice(1, -1);
  }
  return val;
}

/** Last-resort description: the first `# Heading` in the body. Covers reference
 *  docs under .claude/commands that carry neither frontmatter nor a comment. */
function readFirstHeading(text) {
  var m = /^\s*#\s+(.+?)\s*$/m.exec(text);
  return m ? m[1].replace(/\s+/g, ' ').trim() : '';
}

/** Terms from the slug/name. Highest routing signal — router weights these
 *  above description terms so "mastermind orgs" ranks /mastermind:orgs over
 *  the ~60 other /mastermind:* commands that merely share the word. Short
 *  tokens are allowed here so slugs like "do" and "ts" stay routable. */
function deriveNameTerms(name, slug) {
  var seen = new Set();
  var out = [];
  function push(tok) {
    tok = tok.trim().toLowerCase();
    if (!tok || seen.has(tok)) return;
    seen.add(tok);
    out.push(tok);
  }
  String(slug || '').split(/[^A-Za-z0-9]+/).forEach(push);
  String(name || '').split(/[^A-Za-z0-9]+/).forEach(push);
  return out;
}

/** Terms from the description, excluding anything already a name term. */
function deriveKeywords(description, nameTerms) {
  var seen = new Set(nameTerms || []);
  var out = [];
  var words = String(description || '')
    .replace(/[^A-Za-z0-9\s-]/g, ' ')
    .split(/\s+/);
  for (var i = 0; i < words.length && out.length < MAX_KEYWORDS; i++) {
    var tok = words[i].trim().toLowerCase();
    if (tok.length < 3) continue;
    if (STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** True for files/dirs we must never treat as real entries. */
function isJunk(basename) {
  // "._foo" are macOS/exFAT resource forks — they parse as garbage entries.
  // "_foo.md" are shared includes explicitly documented as never-invoked.
  return basename.startsWith('._') || basename.startsWith('_');
}

/** Docs and helper-only pieces: README/overview/reference pages (or anything
 *  under a references/ dir), HELPER_ONLY names, and `type: helper` frontmatter. */
function isNotACandidate(parts, fm) {
  for (var i = 0; i < parts.length; i++) {
    if (DOC_NAMES.has(parts[i].toLowerCase())) return true;
  }
  if (HELPER_ONLY.has(parts[parts.length - 1])) return true;
  return String(fm.type || '').toLowerCase() === 'helper';
}

/** `pick: low` frontmatter, recorded on the entry; nothing otherwise. */
function applyPick(entry, fm) {
  if (String(fm.pick || '').trim().toLowerCase() === 'low') entry.pick = 'low';
  return entry;
}

function walkMarkdown(dir, out) {
  var entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return out;
  }
  for (var i = 0; i < entries.length; i++) {
    var e = entries[i];
    if (isJunk(e.name)) continue;
    var full = path.join(dir, e.name);
    if (e.isDirectory()) walkMarkdown(full, out);
    else if (e.isFile() && e.name.endsWith('.md')) out.push(full);
  }
  return out;
}

/** Scan .claude/commands -> slash-command entries. */
function scanCommands(root) {
  var base = path.join(root, '.claude', 'commands');
  if (!fs.existsSync(base)) return [];
  var files = walkMarkdown(base, []);
  var out = [];
  for (var i = 0; i < files.length; i++) {
    var file = files[i];
    var rel = path.relative(base, file).replace(/\\/g, '/');
    var parts = rel.replace(/\.md$/, '').split('/');
    // Nested commands are namespaced: mastermind/build.md -> /mastermind:build
    var invokeName = parts.length > 1 ? parts.join(':') : parts[0];
    var group = parts.length > 1 ? parts[0] : 'command';

    var text;
    try { text = fs.readFileSync(file, 'utf-8'); } catch (e) { continue; }
    var fm = readFrontmatter(text);
    if (String(fm['user-invocable']).toLowerCase() === 'false') continue;
    if (isNotACandidate(parts, fm)) continue;

    var name = fm.name || parts[parts.length - 1];
    var description = fm.description || readLeadingComment(text) || readFirstHeading(text);
    var nameTerms = deriveNameTerms(name, invokeName);
    out.push(applyPick({
      skill: invokeName,
      invoke: '/' + invokeName,
      kind: 'command',
      description: description,
      nameTerms: nameTerms,
      keywords: deriveKeywords(description, nameTerms),
      category: group,
      source: '.claude/commands/' + rel,
    }, fm));
  }
  return out;
}

/** A catalog projection's marker (monomind catalog project) is the line right
 *  after `# monomind:start catalog:skill:<dir>`:
 *  `<!-- catalog skill:<dir> sha256:<hex> jev:yes|no -->`. Returns { id, jev },
 *  or null for a file with no catalog block at all. A file that has a catalog
 *  block but no valid marker in that position, or one naming another directory,
 *  is a catalog projection that is not Jev-approved (jev: false).
 *  jev-picker.cjs sends a catalog skill to the decision model only when jev is
 *  true. */
function readCatalogMarker(text, dir) {
  if (text.indexOf('monomind:start catalog:skill:') === -1) return null;
  var id = 'skill:' + dir;
  var lines = text.split(/\r?\n/);
  var at = lines.indexOf('# monomind:start catalog:' + id);
  var m = at === -1 ? null : /^<!-- catalog (skill:[a-z0-9][a-z0-9-]*) sha256:[0-9a-f]{64} jev:(yes|no) -->$/.exec(lines[at + 1] || '');
  return { id: id, jev: !!m && m[1] === id && m[2] === 'yes' };
}

/** Scan <base>/<name>/SKILL.md -> Skill() entries. `label` is the source
 *  path prefix written into each entry ('.claude/skills' or '~/.claude/skills'). */
function scanSkillDir(base, label, origin) {
  if (!fs.existsSync(base)) return [];
  var dirs;
  try {
    dirs = fs.readdirSync(base, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  var out = [];
  for (var i = 0; i < dirs.length; i++) {
    var d = dirs[i];
    if (!(d.isDirectory() || d.isSymbolicLink()) || isJunk(d.name)) continue;
    var skillFile = path.join(base, d.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    var text;
    try { text = fs.readFileSync(skillFile, 'utf-8'); } catch (e) { continue; }
    var fm = readFrontmatter(text);
    if (String(fm['user-invocable']).toLowerCase() === 'false') continue;
    if (isNotACandidate([d.name], fm)) continue;

    var name = fm.name || d.name;
    var description = fm.description || readLeadingComment(text) || readFirstHeading(text);
    var nameTerms = deriveNameTerms(name, d.name);
    var entry = {
      skill: d.name,
      invoke: 'Skill("' + d.name + '")',
      kind: 'skill',
      description: description,
      nameTerms: nameTerms,
      keywords: deriveKeywords(description, nameTerms),
      category: 'skill',
      source: label + '/' + d.name + '/SKILL.md',
    };
    if (origin) entry.origin = origin;
    applyPick(entry, fm);
    var catalog = origin ? null : readCatalogMarker(text, d.name);
    if (catalog) entry.catalog = catalog;
    out.push(entry);
  }
  return out;
}

/** Project skills, then the user's ~/.claude/skills for names the project lacks. */
function scanSkills(root, opts) {
  var project = scanSkillDir(path.join(root, '.claude', 'skills'), '.claude/skills');
  if (opts && opts.user === false) return project;
  var taken = new Set(project.map(function (e) { return e.skill; }));
  var user = scanSkillDir(path.join(homeDir(opts), '.claude', 'skills'), '~/.claude/skills', 'user')
    .filter(function (e) { return !taken.has(e.skill); });
  return project.concat(user);
}

function homeDir(opts) {
  return (opts && opts.home) || os.homedir();
}

function indexPath(root) {
  return path.join(root, '.claude', 'helpers', 'skill-registry.json');
}

function readIndex(root) {
  try {
    return JSON.parse(fs.readFileSync(indexPath(root), 'utf-8'));
  } catch (e) {
    return null;
  }
}

/**
 * The index for `root`. opts: { home, env, user (false = skip ~/.claude/skills),
 * bundledDir (the CLI's org-skills dir; else the one the last build recorded) }.
 */
function build(root, opts) {
  opts = Object.assign({}, opts);
  var prev = readIndex(root);
  var prevMeta = (prev && prev._meta) || {};
  if (!opts.bundledDir && typeof prevMeta.bundledOrgSkillsDir === 'string') opts.bundledDir = prevMeta.bundledOrgSkillsDir;
  var entries = scanCommands(root).concat(scanSkills(root, opts));
  var orgSkills = orgIndex.scanOrgSkills(root, opts);
  var bundled = orgIndex.bundledOrgSkillsDir(root, opts);

  // Preserve hand-tuned keywords for entries that still resolve by the same
  // key, so manual curation isn't blown away on every regeneration.
  var curated = {};
  try {
    var prevList = (prev && prev.skills) || [];
    for (var i = 0; i < prevList.length; i++) {
      var p = prevList[i];
      if (p && p.skill && p.curatedKeywords) curated[p.skill] = p.curatedKeywords;
    }
  } catch (e) { /* first run / unreadable — nothing to preserve */ }

  for (var j = 0; j < entries.length; j++) {
    var c = curated[entries[j].skill];
    if (c && Array.isArray(c) && c.length) {
      entries[j].curatedKeywords = c;
      // Curated terms win, derived terms fill the remainder.
      var merged = c.slice();
      for (var k = 0; k < entries[j].keywords.length && merged.length < MAX_KEYWORDS; k++) {
        if (merged.indexOf(entries[j].keywords[k]) === -1) merged.push(entries[j].keywords[k]);
      }
      entries[j].keywords = merged;
    }
  }

  entries.sort(function (a, b) { return a.skill < b.skill ? -1 : a.skill > b.skill ? 1 : 0; });

  return {
    _meta: {
      version: '2.0.0',
      description:
        'Auto-generated index of the project\'s slash commands (.claude/commands) and ' +
        'skills (.claude/skills), the user\'s ~/.claude/skills, and the Org skill library ' +
        '(orgSkills). Read by router.cjs matchSkills() and jev-catalog.cjs.',
      generatedBy: '.claude/helpers/build-skill-registry.cjs',
      regenerate: 'node .claude/helpers/build-skill-registry.cjs',
      note:
        'DO NOT hand-edit entries — regeneration overwrites them. To pin keywords for ' +
        'an entry, add a "curatedKeywords" array to it; those survive regeneration and ' +
        'take precedence over derived ones.',
      scope:
        'Generated per machine — never commit it. Regenerated by init, upgrade, ' +
        'SessionStart and `monomind pick` when a source tree is newer than this file.',
      bundledOrgSkillsDir: bundled,
      counts: {
        commands: entries.filter(function (e) { return e.kind === 'command'; }).length,
        skills: entries.filter(function (e) { return e.kind === 'skill'; }).length,
        user: entries.filter(function (e) { return e.origin === 'user'; }).length,
        orgSkills: orgSkills.length,
        total: entries.length,
      },
    },
    skills: entries,
    orgSkills: orgSkills,
  };
}

/** Writes build(root, opts) to .claude/helpers/skill-registry.json atomically. */
function write(root, opts) {
  var registry = build(root, opts);
  var outPath = indexPath(root);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  var tmp = outPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, outPath);
  return registry;
}

/** Newest mtime of a skills root: the dir, each skill dir and its SKILL.md. */
function skillTreeMtime(base) {
  var newest = mtime(base);
  var names;
  try { names = fs.readdirSync(base); } catch (e) { return newest; }
  names.forEach(function (n) {
    newest = Math.max(newest, mtime(path.join(base, n)), mtime(path.join(base, n, 'SKILL.md')));
  });
  return newest;
}

function mtime(p) {
  try { return fs.statSync(p).mtimeMs; } catch (e) { return 0; }
}

/** Newest mtime across every source the index is built from (a cheap stat
 *  scan; the shipped org library counts by its directory only). */
function sourcesMtime(root, opts) {
  var newest = Math.max(
    skillTreeMtime(path.join(root, '.claude', 'skills')),
    mtime(path.join(root, '.monomind', 'catalog', 'state.json')),
    mtime(__filename),
    mtime(require.resolve('./org-skill-index.cjs'))
  );
  walkMarkdown(path.join(root, '.claude', 'commands'), []).forEach(function (f) {
    newest = Math.max(newest, mtime(f), mtime(path.dirname(f)));
  });
  if (!opts || opts.user !== false) newest = Math.max(newest, skillTreeMtime(path.join(homeDir(opts), '.claude', 'skills')));
  orgIndex.orgSkillRoots(root, opts).forEach(function (r) {
    newest = Math.max(newest, r.origin === 'bundled' ? mtime(r.dir) : skillTreeMtime(r.dir));
  });
  return newest;
}

/** True when the index is missing or older than one of its sources. */
function isStale(root, opts) {
  var at = mtime(indexPath(root));
  return at === 0 || sourcesMtime(root, opts) >= at;
}

/** The index for `root`, rebuilt and written first when stale. */
function ensure(root, opts) {
  if (isStale(root, opts)) return write(root, opts);
  return readIndex(root) || write(root, opts);
}

function main() {
  var root = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  var registry = write(root);
  process.stdout.write(
    'skill-registry.json: ' + registry._meta.counts.total + ' entries (' +
    registry._meta.counts.commands + ' commands, ' +
    registry._meta.counts.skills + ' skills, ' +
    registry._meta.counts.orgSkills + ' org skills)\n'
  );
}

if (require.main === module) main();

module.exports = {
  build: build,
  write: write,
  isStale: isStale,
  ensure: ensure,
  indexPath: indexPath,
  HELPER_ONLY: HELPER_ONLY,
  readFrontmatter: readFrontmatter,
  deriveNameTerms: deriveNameTerms,
  deriveKeywords: deriveKeywords,
  readCatalogMarker: readCatalogMarker,
};
