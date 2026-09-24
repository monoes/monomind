'use strict';
/**
 * The Org skill library, read from CommonJS so the skill index
 * (build-skill-registry.cjs) and the Jev catalog loader (jev-catalog.cjs) see
 * the same Org skills `monomind org skills` does (src/orgrt/skill-library.ts):
 *
 *   1. <project>/.monomind/org-skills          origin 'project'
 *   2. $MONOMIND_HOME|~/.monomind/org-skills    origin 'user'
 *   3. <package>/org-skills                     origin 'bundled'
 *   then active catalog skills/archetypes that target `org`, with their
 *   package digest verified (before the roots when `replacesLegacy`).
 *
 * First match wins by name. Body-free: only name, description and tags.
 */
var fs = require('fs');
var os = require('os');
var path = require('path');
var crypto = require('crypto');

var SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
var MAX_FILE_BYTES = 512 * 1024;

function unquote(s) {
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') {
    try { return JSON.parse(s); } catch (e) { return s.slice(1, -1); }
  }
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  return s;
}

/** description + tags from a SKILL.md frontmatter (scalars, block scalars,
 *  flow lists and block lists — the shapes skill-library.ts reads). */
function readMeta(text) {
  var m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  var data = {};
  if (!m) return { description: '', tags: [] };
  var lines = m[1].split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (!kv) continue;
    var val = kv[2].trim();
    var cont = [];
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) cont.push(lines[++i]);
    if (val === '' && cont.some(function (l) { return /^\s*-\s+/.test(l); })) {
      data[kv[1]] = cont.filter(function (l) { return /^\s*-\s+/.test(l); })
        .map(function (l) { return unquote(l.replace(/^\s*-\s+/, '').trim()); });
    } else if (/^[>|][+-]?$/.test(val)) {
      var parts = cont.map(function (l) { return l.trim(); });
      data[kv[1]] = (val[0] === '>' ? parts.join(' ') : parts.join('\n')).trim();
    } else if (val[0] === '[' && val[val.length - 1] === ']') {
      data[kv[1]] = val.slice(1, -1).split(',').map(function (s) { return unquote(s.trim()); }).filter(Boolean);
    } else if (val !== '') {
      data[kv[1]] = unquote([val].concat(cont.map(function (l) { return l.trim(); })).join(' ').trim());
    }
  }
  var d = data.description;
  var t = data.tags;
  return {
    description: Array.isArray(d) ? d.join(', ') : d || '',
    tags: Array.isArray(t) ? t : typeof t === 'string' ? t.split(/[,\s]+/).filter(Boolean) : [],
  };
}

function readSkill(dir) {
  var file = path.join(dir, 'SKILL.md');
  try {
    if (fs.statSync(file).size > MAX_FILE_BYTES) return null;
    return readMeta(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

var CLI_PACKAGE = '@monoes/monomindcli';

function isCliPackage(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).name === CLI_PACKAGE;
  } catch (e) {
    return false;
  }
}

/** The shipped library: opts.bundledDir (recorded by the CLI), else
 *  <package>/org-skills when this helper runs from the CLI package's
 *  .claude/helpers, else the CLI package the project resolves. Null if none. */
function bundledOrgSkillsDir(root, opts) {
  opts = opts || {};
  var pkg = path.join(__dirname, '..', '..');
  var candidates = [opts.bundledDir, isCliPackage(pkg) ? path.join(pkg, 'org-skills') : null];
  [CLI_PACKAGE, 'monomind'].forEach(function (name) {
    try {
      var found = path.dirname(require.resolve(name + '/package.json', { paths: [root] }));
      if (name === 'monomind') {
        found = path.dirname(require.resolve(CLI_PACKAGE + '/package.json', { paths: [found] }));
      }
      candidates.push(path.join(found, 'org-skills'));
    } catch (e) { /* not installed there */ }
  });
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    try {
      if (c && fs.statSync(c).isDirectory()) return path.resolve(c);
    } catch (e) { /* next */ }
  }
  return null;
}

function orgSkillRoots(root, opts) {
  opts = opts || {};
  var env = opts.env || process.env;
  var home = env.MONOMIND_HOME || path.join(opts.home || os.homedir(), '.monomind');
  var roots = [
    { dir: path.join(root, '.monomind', 'org-skills'), origin: 'project' },
    { dir: path.join(home, 'org-skills'), origin: 'user' },
  ];
  var bundled = bundledOrgSkillsDir(root, opts);
  if (bundled) roots.push({ dir: bundled, origin: 'bundled' });
  return roots;
}

// ── Catalog (.monomind/catalog) ────────────────────────────────────────────

/** state.json entries, or null when there is no state file; [] + ok:false when unreadable. */
function readCatalogState(root) {
  var file = path.join(root, '.monomind', 'catalog', 'state.json');
  if (!fs.existsSync(file)) return null;
  try {
    var state = JSON.parse(fs.readFileSync(file, 'utf-8'));
    return Array.isArray(state && state.entries) ? { ok: true, entries: state.entries } : { ok: false, entries: [] };
  } catch (e) {
    return { ok: false, entries: [] };
  }
}

function packageFiles(dir, prefix, out) {
  fs.readdirSync(path.join(dir, prefix), { withFileTypes: true }).forEach(function (e) {
    var rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isSymbolicLink()) throw new Error('symlink in package: ' + rel);
    if (e.isDirectory()) packageFiles(dir, rel, out);
    else if (e.isFile()) out.push(rel);
  });
  return out;
}

/** Same digest as src/catalog/digest.ts packageDigest. */
function packageDigest(dir) {
  var h = crypto.createHash('sha256');
  packageFiles(dir, '', []).sort().forEach(function (rel) {
    var bytes = fs.readFileSync(path.join(dir, rel));
    var p = Buffer.from(rel, 'utf8');
    var lens = Buffer.alloc(12);
    lens.writeUInt32BE(p.length, 0);
    lens.writeBigUInt64BE(BigInt(bytes.length), 4);
    h.update(lens.subarray(0, 4)).update(p).update(lens.subarray(4)).update(bytes);
  });
  return h.digest('hex');
}

/** The verified package dir of a catalog entry, or null (missing, escaping, tampered). */
function verifyCatalogPackage(root, entry) {
  try {
    if (typeof entry.id !== 'string' || typeof entry.sha256 !== 'string') return null;
    var store = fs.realpathSync(path.join(root, '.monomind', 'catalog', 'packages'));
    var dir = fs.realpathSync(path.join(store, entry.id.split(':')[1] || '', entry.sha256.slice(0, 12)));
    var rel = path.relative(store, dir);
    if (rel.indexOf('..') === 0 || path.isAbsolute(rel)) return null;
    return packageDigest(dir) === entry.sha256 ? dir : null;
  } catch (e) {
    return null;
  }
}

function isActiveFor(e, target) {
  return !!e && e.status === 'active' && Array.isArray(e.targets) && e.targets.indexOf(target) !== -1;
}

/** Active, verified, org-target catalog skills (not blueprints) as index entries. */
function catalogOrgSkills(root) {
  var state = readCatalogState(root);
  if (!state || !state.ok) return [];
  var out = [];
  state.entries.forEach(function (e) {
    if (!isActiveFor(e, 'org') || e.kind === 'blueprint' || typeof e.id !== 'string') return;
    var name = e.id.slice(e.id.indexOf(':') + 1);
    if (!SKILL_NAME_RE.test(name)) return;
    var dir = verifyCatalogPackage(root, e);
    var meta = dir && readSkill(dir);
    if (!meta) return;
    out.push({
      name: name, description: meta.description, tags: meta.tags, origin: 'catalog',
      catalogId: e.id, sha256: e.sha256, replacesLegacy: e.replacesLegacy === true,
    });
  });
  return out;
}

/** Every Org skill (overrides resolved), sorted by name — listSkills() parity. */
function scanOrgSkills(root, opts) {
  var seen = new Map();
  var catalog = catalogOrgSkills(root);
  orgSkillRoots(root, opts).forEach(function (r) {
    var names;
    try { names = fs.readdirSync(r.dir); } catch (e) { return; }
    names.forEach(function (name) {
      if (seen.has(name) || !SKILL_NAME_RE.test(name)) return;
      var meta = readSkill(path.join(r.dir, name));
      if (meta) seen.set(name, { name: name, description: meta.description, tags: meta.tags, origin: r.origin });
    });
  });
  catalog.forEach(function (c) {
    if (seen.has(c.name) && !c.replacesLegacy) return;
    var entry = Object.assign({}, c);
    delete entry.replacesLegacy;
    seen.set(c.name, entry);
  });
  return Array.from(seen.values()).sort(function (a, b) { return a.name.localeCompare(b.name); });
}

module.exports = {
  SKILL_NAME_RE: SKILL_NAME_RE,
  readMeta: readMeta,
  bundledOrgSkillsDir: bundledOrgSkillsDir,
  orgSkillRoots: orgSkillRoots,
  readCatalogState: readCatalogState,
  packageDigest: packageDigest,
  verifyCatalogPackage: verifyCatalogPackage,
  isActiveFor: isActiveFor,
  scanOrgSkills: scanOrgSkills,
};
