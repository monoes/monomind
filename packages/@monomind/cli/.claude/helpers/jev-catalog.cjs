'use strict';
/**
 * Candidate catalogs for the Jev picker — ONE implementation shared by the
 * prompt hook (via jev-picker.cjs) and the CLI (`monomind pick`, MCP pick via
 * src/decision/catalogs.ts), so both rank exactly the same agents and skills.
 *
 *   agents  .monomind/registry.json            (agent-registry.cjs: project,
 *           ~/.claude/agents and extra roots)
 *   skills  .claude/helpers/skill-registry.json (build-skill-registry.cjs):
 *           `skills` = platform commands/skills, `orgSkills` = Org library
 */
var fs = require('fs');
var os = require('os');
var path = require('path');

var MAX_CATALOG_BYTES = 5 * 1024 * 1024;

/** Org skills that duplicate a platform skill under another name: the
 *  platform one (directly invokable) is kept. Keys and values are norm()ed. */
var ORG_ALIASES = {
  'architecture-decision-records': 'mastermind-adr',
  'release-manager': 'mastermind-release',
  'using-git-worktrees': 'mastermind-worktree',
  'systematic-debugging': 'mastermind-debug',
  'writing-plans': 'mastermind-plan',
  'receiving-code-review': 'mastermind-receive-review',
};

function readJsonFile(file) {
  try {
    if (!fs.existsSync(file) || fs.statSync(file).size > MAX_CATALOG_BYTES) return null;
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    return null;
  }
}

function strings(list) {
  return (Array.isArray(list) ? list : []).filter(function (s) {
    return typeof s === 'string';
  });
}

/** Lowercase, every non-alphanumeric run a single '-': "mastermind:plan",
 *  "mastermind_plan" and "Mastermind Plan" all meet. */
function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Agents from .monomind/registry.json (built by registry-builder.ts), or from
 *  opts.registry (an in-memory build outside a project). The description leads
 *  with the one-line `when_to_use`; deprecated agents drop. The `vibe`
 *  personality line is not ranked: its words ("crashes", "segfault") name no
 *  capability and pulled unrelated tasks to the agent. */
function loadAgentCatalog(root, opts) {
  var reg = (opts && opts.registry) || readJsonFile(path.join(root, '.monomind', 'registry.json'));
  var list = reg && Array.isArray(reg.agents) ? reg.agents : [];
  var out = [];
  var seen = new Set();
  list.forEach(function (a) {
    if (!a || typeof a.slug !== 'string' || a.deprecated === true || seen.has(a.slug)) return;
    seen.add(a.slug);
    var category = typeof a.category === 'string' ? a.category : '';
    var description = typeof a.description === 'string' ? a.description : '';
    var when = typeof a.whenToUse === 'string' ? a.whenToUse.trim() : '';
    var item = {
      id: a.slug,
      name: typeof a.name === 'string' ? a.name : a.slug,
      category: category,
      description: when ? when + (description ? ' — ' + description : '') : description,
      text: [category]
        .concat(strings(a.tags), strings(a.capabilities), strings(a.taskTypes))
        .filter(Boolean)
        .join(' '),
    };
    // 'project' | 'user' (~/.claude/agents) | 'extra'; shown by `pick --json`, never sent to the model.
    if (typeof a.origin === 'string') item.origin = a.origin;
    out.push(item);
  });
  return out;
}

/** .monomind/catalog/state.json as { ok, entries } (entries maps a catalog id
 *  to its state entry); null without a state file. */
function catalogJevGate(root) {
  var file = path.join(root, '.monomind', 'catalog', 'state.json');
  if (!fs.existsSync(file)) return null;
  var state = readJsonFile(file);
  var gate = { ok: !!state && Array.isArray(state.entries), entries: new Map() };
  (gate.ok ? state.entries : []).forEach(function (e) {
    if (e && typeof e.id === 'string') gate.entries.set(e.id, e);
  });
  return gate;
}

/** A registry `source` as a file path: `~/…` (user skills) under the home
 *  directory, anything else under the project root. */
function sourceFile(root, source) {
  if (typeof source !== 'string') return '';
  if (source === '~' || source.indexOf('~/') === 0) return path.join(os.homedir(), source.slice(1));
  return path.resolve(root, source);
}

/** True when the indexed file carries a catalog projection block. Only files
 *  inside the project or ~/.claude/skills are read. */
function isProjectedCopy(root, source) {
  var file = sourceFile(root, source);
  var inside = [path.resolve(root), path.join(os.homedir(), '.claude', 'skills')].some(function (dir) {
    return file.indexOf(dir + path.sep) === 0;
  });
  if (!inside) return false;
  try {
    if (fs.statSync(file).size > MAX_CATALOG_BYTES) return false;
    return fs.readFileSync(file, 'utf-8').indexOf('monomind:start catalog:skill:') !== -1;
  } catch (e) {
    return false;
  }
}

function activeForJev(e) {
  return !!e && e.status === 'active' && Array.isArray(e.targets) && e.targets.indexOf('jev') !== -1;
}

/** The package a state entry names still hashes to its recorded digest (the
 *  same egress check as catalogs.ts jevVisible). */
function packageVerifies(root, e) {
  try {
    return !!require('./org-skill-index.cjs').verifyCatalogPackage(root, e);
  } catch (err) {
    return false;
  }
}

/** The catalog state decides, never the forgeable projection marker: a skill
 *  that is a catalog projection (a `catalog` field, or a projection block in
 *  its file for an index from an old builder) is sent only while this
 *  project's state.json parses, lists it active with the `jev` target, and its
 *  package verifies. Missing or unreadable state drops every such skill (fail
 *  closed). Skills that are not projections are unaffected. */
function jevAllowed(gate, s, root) {
  if (!s.catalog && !isProjectedCopy(root, s.source)) return true;
  var id = s.catalog ? String(s.catalog.id) : 'skill:' + s.skill;
  var e = gate && gate.ok ? gate.entries.get(id) : null;
  return activeForJev(e) && packageVerifies(root, e);
}

/** Platform commands/skills. Command/skill mirrors of one capability collapse,
 *  preferring the slash form. */
function platformSkills(root, list, gate) {
  var byKey = new Map();
  list.forEach(function (s) {
    if (!s || typeof s.skill !== 'string' || typeof s.invoke !== 'string') return;
    // A catalog projection reaches the decision model only when approved with
    // the jev target; ordinary skills carry no catalog field and are unaffected.
    if (s.catalog && s.catalog.jev !== true) return;
    if (!jevAllowed(gate, s, root)) return;
    var key = s.skill.toLowerCase().replace(/[:_]/g, '-');
    var prev = byKey.get(key);
    if (prev && !(s.invoke.charAt(0) === '/' && prev.invoke.charAt(0) !== '/')) return;
    var item = {
      id: s.skill,
      invoke: s.invoke,
      description: typeof s.description === 'string' ? s.description : '',
      text: strings(s.nameTerms).concat(strings(s.keywords)).join(' '),
      source: 'platform',
    };
    // Admin/meta entries (frontmatter `pick: low`) rank below equal matches.
    if (s.pick === 'low') item.pick = 'low';
    byKey.set(key, item);
  });
  return Array.from(byKey.values());
}

/** A catalog Org skill leaves the machine only while its state entry is active
 *  with the jev target, names the indexed package, and that package verifies
 *  now (the same egress check as catalogs.ts jevVisible). */
function catalogOrgAllowed(root, gate, s) {
  var e = gate && gate.ok ? gate.entries.get(s.catalogId) : null;
  return activeForJev(e) && e.sha256 === s.sha256 && packageVerifies(root, e);
}

/** Org-library skills that are not a platform skill by name or known alias,
 *  and not an agent (an Org skill named after an agent duplicates it). */
function orgSkills(root, list, taken, gate) {
  var out = [];
  var seen = new Set();
  list.forEach(function (s) {
    if (!s || typeof s.name !== 'string' || seen.has(s.name)) return;
    var key = norm(s.name);
    if (taken.has(key) || (ORG_ALIASES[key] && taken.has(ORG_ALIASES[key]))) return;
    if (s.origin === 'catalog' && !catalogOrgAllowed(root, gate, s)) return;
    seen.add(s.name);
    out.push({
      id: s.name,
      description: typeof s.description === 'string' ? s.description : '',
      text: strings(s.tags).join(' '),
      source: 'org',
      invoke: 'mcp__monomind__org_skill_show ' + JSON.stringify({ name: s.name }),
    });
  });
  return out;
}

/**
 * Every skill a task can use, as one list: platform skills (directly
 * invokable) first, then Org-library skills (read with the org_skill_show MCP
 * tool, or `npx -y monomind org skills show <name>`). opts.index: an
 * already-built index object (the CLI passes the one it just refreshed);
 * otherwise the file is read. opts.registry: the agent
 * registry to dedupe against (see loadAgentCatalog).
 */
function loadSkillCatalog(root, opts) {
  var reg = (opts && opts.index) || readJsonFile(path.join(root, '.claude', 'helpers', 'skill-registry.json'));
  var gate = catalogJevGate(root);
  var platform = platformSkills(root, reg && Array.isArray(reg.skills) ? reg.skills : [], gate);
  var taken = new Set();
  platform.forEach(function (s) { taken.add(norm(s.id)); });
  loadAgentCatalog(root, opts).forEach(function (a) {
    taken.add(norm(a.id));
    taken.add(norm(a.name));
  });
  return platform.concat(orgSkills(root, reg && Array.isArray(reg.orgSkills) ? reg.orgSkills : [], taken, gate));
}

module.exports = {
  ORG_ALIASES: ORG_ALIASES,
  norm: norm,
  loadAgentCatalog: loadAgentCatalog,
  loadSkillCatalog: loadSkillCatalog,
  catalogJevGate: catalogJevGate,
};
