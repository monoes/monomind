'use strict';
/**
 * Skill keyword matcher for the prompt hook.
 *
 * handlers/route-handler.cjs calls matchSkills() for its skill hint. Agent
 * picks come from .monomind/registry.json via the pick index, not from this
 * file: the keyword agent table (routeTask) that used to live here named
 * slugs that are not installed agents, and nothing at runtime called it.
 *
 * Exports:
 *   matchSkills(prompt, topN)   → array of { skill, invoke, description, score }
 */

// ── Skills registry ────────────────────────────────────────────────────────────
// Loaded from .claude/helpers/skill-registry.json, which is generated from the
// live .claude/commands + .claude/skills trees by build-skill-registry.cjs.
// Before that file was wired up, this list was hardcoded here with 6 entries —
// one of which (/graphify) pointed at a command that does not exist — while a
// separate 53-entry skill-registry.json sat unread with 28 stale entries.
//
// FALLBACK_SKILLS is only used when the registry is missing or unreadable
// (e.g. a checkout that never ran the generator). Every entry here is verified
// to exist as .claude/commands/<name>.md.

var FALLBACK_SKILLS = [
  { skill: 'mastermind', invoke: '/mastermind', description: 'Universal intent router',
    nameTerms: ['mastermind'],
    keywords: ['swarm', 'topology', 'hive', 'multi-agent', 'route'] },
  { skill: 'monodesign', invoke: '/monodesign', description: 'Frontend design and UI',
    nameTerms: ['monodesign'],
    keywords: ['design', 'ui', 'ux', 'component', 'visual', 'layout', 'css', 'theme'] },
  { skill: 'monomotion', invoke: '/monomotion', description: 'Web animations and motion',
    nameTerms: ['monomotion'],
    keywords: ['animate', 'animation', 'motion', 'gsap', 'transition', 'scroll'] },
  { skill: 'monobrowse', invoke: '/monobrowse', description: 'Browser automation via CDP',
    nameTerms: ['monobrowse'],
    keywords: ['browse', 'browser', 'webpage', 'screenshot', 'navigate', 'cdp'] },
  { skill: 'tokens', invoke: '/tokens', description: 'Token usage and cost tracking',
    nameTerms: ['tokens'],
    keywords: ['token', 'cost', 'spending', 'budget'] },
];

var _skillsCache = null;
var _skillsCacheTs = 0;
var SKILLS_TTL_MS = 60000;

function loadSkills() {
  var now = Date.now();
  if (_skillsCache && (now - _skillsCacheTs) < SKILLS_TTL_MS) return _skillsCache;

  var skills = FALLBACK_SKILLS;
  try {
    var fs = require('fs');
    var path = require('path');
    var cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    var regPath = path.join(cwd, '.claude', 'helpers', 'skill-registry.json');
    var MAX_SIZE = 2 * 1024 * 1024;
    if (fs.existsSync(regPath) && fs.statSync(regPath).size <= MAX_SIZE) {
      var parsed = JSON.parse(fs.readFileSync(regPath, 'utf-8'));
      var list = parsed && parsed.skills;
      if (Array.isArray(list) && list.length > 0) {
        skills = list.filter(function (s) {
          return s && typeof s.skill === 'string' && typeof s.invoke === 'string';
        });
        if (skills.length === 0) skills = FALLBACK_SKILLS;
      }
    }
  } catch (e) { /* keep fallback */ }

  _skillsCache = skills;
  _skillsCacheTs = now;
  return skills;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

var MAX_PROMPT = 2000;

// ── matchSkills ────────────────────────────────────────────────────────────────

/** Conservative suffix stemmer so "animate" matches the keyword "animation"
 *  and "reviews" matches "review". Only strips when >= 4 chars remain, which
 *  keeps short words ("uses" -> "us") from collapsing into noise. */
function stem(tok) {
  var suffixes = ['ions', 'ing', 'ion', 'ies', 'ed', 'es', 's'];
  for (var i = 0; i < suffixes.length; i++) {
    var suf = suffixes[i];
    if (tok.length - suf.length >= 4 && tok.slice(-suf.length) === suf) {
      tok = tok.slice(0, -suf.length);
      break;
    }
  }
  // "animate" -> "animat" so it meets "animation" -> "animat".
  if (tok.length >= 5 && tok.slice(-1) === 'e') tok = tok.slice(0, -1);
  return tok;
}

/** Tokenize a prompt into a whole-word lookup set (raw + stemmed). Whole-word
 *  matching (rather than substring) keeps short slugs like "do" and "ts" from
 *  matching inside unrelated words ("download", "tests"). Hyphenated tokens are
 *  indexed both whole and split, so "dark-mode" also matches "dark"/"mode". */
function tokenizePrompt(text) {
  var set = new Set();
  function add(tok) {
    if (!tok) return;
    set.add(tok);
    set.add(stem(tok));
  }
  var raw = String(text).toLowerCase().split(/[^a-z0-9-]+/);
  for (var i = 0; i < raw.length; i++) {
    var tok = raw[i];
    if (!tok) continue;
    add(tok);
    if (tok.indexOf('-') !== -1) {
      var parts = tok.split('-');
      for (var p = 0; p < parts.length; p++) add(parts[p]);
    }
  }
  return set;
}

/** A registry term matches when either its literal or stemmed form is present. */
function termHit(tokens, term) {
  return tokens.has(term) || tokens.has(stem(term));
}

/** Commands and skills frequently mirror each other (/mastermind:design and
 *  Skill("mastermind-design") are the same capability). Collapse them so one
 *  capability occupies one slot — otherwise duplicates exhaust the match budget
 *  and block route-handler's <= 2 auto-activation gate. */
function dedupeKey(skillName) {
  return String(skillName).toLowerCase().replace(/[:_]/g, '-');
}

function matchSkills(prompt, topN) {
  if (!prompt || typeof prompt !== 'string') return [];
  topN = topN || 5;
  var tokens = tokenizePrompt(prompt.slice(0, MAX_PROMPT));
  if (tokens.size === 0) return [];

  var skills = loadSkills();
  var scored = [];

  for (var i = 0; i < skills.length; i++) {
    var s = skills[i];
    var nameHits = 0;
    var descHits = 0;

    var nt = s.nameTerms || [];
    for (var n = 0; n < nt.length; n++) if (termHit(tokens, nt[n])) nameHits++;

    var kw = s.keywords || [];
    for (var k = 0; k < kw.length; k++) if (termHit(tokens, kw[k])) descHits++;

    // Name terms are the strong signal: they distinguish /mastermind:orgs from
    // the ~60 sibling /mastermind:* commands that merely share the word.
    var score = nameHits * 2 + descHits;

    // Require real evidence — a single generic description word ("task",
    // "file") must not be enough to surface a suggestion out of 157 entries.
    if (score < 2) continue;

    scored.push({
      skill: s.skill,
      invoke: s.invoke,
      description: s.description || '',
      score: score,
    });
  }

  // Collapse command/skill mirrors of the same capability, keeping the better
  // score; on a tie prefer the slash-command form, which is what users type.
  var byKey = new Map();
  for (var d = 0; d < scored.length; d++) {
    var cur = scored[d];
    var key = dedupeKey(cur.skill);
    var prev = byKey.get(key);
    if (!prev) { byKey.set(key, cur); continue; }
    if (cur.score > prev.score) byKey.set(key, cur);
    else if (cur.score === prev.score && cur.invoke.charAt(0) === '/') byKey.set(key, cur);
  }
  scored = Array.from(byKey.values());

  scored.sort(function (a, b) { return b.score - a.score; });

  // Dominance trim: when the leader more than doubles the runner-up the intent
  // is unambiguous, so return it alone. route-handler.cjs only auto-activates
  // when <= 2 matches come back — without this, a clear winner would be buried
  // in a list of weak siblings and never auto-activate.
  if (scored.length > 1 && scored[0].score >= scored[1].score * 2) return [scored[0]];

  return scored.slice(0, topN);
}

// ── exports ────────────────────────────────────────────────────────────────────

module.exports = {
  matchSkills: matchSkills,
};
