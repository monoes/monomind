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
 * Scope is deliberately project-local (.claude/commands, .claude/skills).
 * User-global plugin skills (~/.claude/plugins) are intentionally excluded —
 * this file is committed and shipped, so machine-specific entries would make
 * it wrong for everyone else.
 *
 * Usage:  node .claude/helpers/build-skill-registry.cjs [projectRoot]
 */

var fs = require('fs');
var path = require('path');

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

    var name = fm.name || parts[parts.length - 1];
    var description = fm.description || readLeadingComment(text) || readFirstHeading(text);
    var nameTerms = deriveNameTerms(name, invokeName);
    out.push({
      skill: invokeName,
      invoke: '/' + invokeName,
      kind: 'command',
      description: description,
      nameTerms: nameTerms,
      keywords: deriveKeywords(description, nameTerms),
      category: group,
      source: '.claude/commands/' + rel,
    });
  }
  return out;
}

/** Scan .claude/skills/<name>/SKILL.md -> Skill() entries. */
function scanSkills(root) {
  var base = path.join(root, '.claude', 'skills');
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
    if (!d.isDirectory() || isJunk(d.name)) continue;
    var skillFile = path.join(base, d.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    var text;
    try { text = fs.readFileSync(skillFile, 'utf-8'); } catch (e) { continue; }
    var fm = readFrontmatter(text);
    if (String(fm['user-invocable']).toLowerCase() === 'false') continue;

    var name = fm.name || d.name;
    var description = fm.description || readLeadingComment(text) || readFirstHeading(text);
    var nameTerms = deriveNameTerms(name, d.name);
    out.push({
      skill: d.name,
      invoke: 'Skill("' + d.name + '")',
      kind: 'skill',
      description: description,
      nameTerms: nameTerms,
      keywords: deriveKeywords(description, nameTerms),
      category: 'skill',
      source: '.claude/skills/' + d.name + '/SKILL.md',
    });
  }
  return out;
}

function build(root) {
  var entries = scanCommands(root).concat(scanSkills(root));

  // Preserve hand-tuned keywords for entries that still resolve by the same
  // key, so manual curation isn't blown away on every regeneration.
  var registryPath = path.join(root, '.claude', 'helpers', 'skill-registry.json');
  var curated = {};
  try {
    var prev = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
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
        'Auto-generated index of project-local slash commands (.claude/commands) and ' +
        'skills (.claude/skills). Read by router.cjs matchSkills() to suggest a skill ' +
        'for a routed task.',
      generatedBy: '.claude/helpers/build-skill-registry.cjs',
      regenerate: 'node .claude/helpers/build-skill-registry.cjs',
      note:
        'DO NOT hand-edit entries — regeneration overwrites them. To pin keywords for ' +
        'an entry, add a "curatedKeywords" array to it; those survive regeneration and ' +
        'take precedence over derived ones.',
      scope:
        'Project-local only. User-global plugin skills (~/.claude/plugins) are excluded ' +
        'on purpose — this file is committed, so machine-specific entries would be wrong ' +
        'for other checkouts.',
      counts: {
        commands: entries.filter(function (e) { return e.kind === 'command'; }).length,
        skills: entries.filter(function (e) { return e.kind === 'skill'; }).length,
        total: entries.length,
      },
    },
    skills: entries,
  };
}

function main() {
  var root = process.argv[2] || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  var registry = build(root);
  var outPath = path.join(root, '.claude', 'helpers', 'skill-registry.json');
  var tmp = outPath + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2) + '\n', 'utf-8');
  fs.renameSync(tmp, outPath);
  process.stdout.write(
    'skill-registry.json: ' + registry._meta.counts.total + ' entries (' +
    registry._meta.counts.commands + ' commands, ' +
    registry._meta.counts.skills + ' skills)\n'
  );
}

if (require.main === module) main();

module.exports = {
  build: build,
  readFrontmatter: readFrontmatter,
  deriveNameTerms: deriveNameTerms,
  deriveKeywords: deriveKeywords,
};
