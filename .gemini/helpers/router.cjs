'use strict';
/**
 * Keyword-based task router for hook-handler.cjs
 * Returns: { agent, agentSlug, confidence, reason, semanticRouting, specificAgents, skillMatches, extrasMatches }
 *
 * Exports:
 *   routeTask(prompt)           → routing result object
 *   routeTaskSemantic(prompt)   → alias for routeTask
 *   matchSkills(prompt, topN)   → array of { skill, invoke, score }
 *   matchExtras(prompt, topN)   → array of { slug, name, category, score }
 *   buildCategoryList()         → array of { name, count, examples }
 *   getAgentsInCategory(cat)    → array of { slug, name }
 *   AGENT_CAPABILITIES          → { [slug]: string[] }
 *   TASK_PATTERNS               → { [agentSlug]: RegExp }
 */

// ── Dev patterns (slug-correct) ─────────────────────────────────────────────
// TASK_PATTERNS: { keywords: agentSlug } — exported for introspection
// Values are agent slugs; keys describe what keywords trigger that agent.

var TASK_PATTERNS = {
  'test|spec|coverage|vitest|jest|mocha|e2e':                  'tester',
  'review|audit|code quality|lint|refactor|cleanup':           'reviewer',
  'architect|system design|ADR|bounded context|architecture':  'architect',
  'security|vulnerability|CVE|injection|XSS|CSRF|OWASP':       'security-engineer',
  'deploy|CI/CD|docker|kubernetes|infra|devops|helm|terraform': 'devops',
  'document|readme|docs|api reference|jsdoc':                  'technical-writer',
  'research|investigate|explore|analyze|survey|compare':       'researcher',
  'plan|roadmap|prioritize|breakdown|estimate':                 'planner',
  'mobile|ios|android|react native|flutter':                   'mobile-dev',
  'ml|machine learning|neural network|model training':          'ai-engineer',
  'api|rest|graphql|endpoint|http|websocket|grpc|optimize':    'backend-dev',
  'ui|frontend|react|vue|component|css|layout|style':          'frontend-dev',
  'bug|fix|error|feature|implement|build|create|develop':      'coder',
};

// Internal routing patterns (regex per slug for routeTask)
var _ROUTING_PATTERNS = {
  'tester':      /\b(test|tests|spec|coverage|vitest|jest|mocha|e2e)\b/i,
  'reviewer':    /\b(review|audit|code quality|lint|smell|refactor|clean up|cleanup)\b/i,
  'architect':   /\b(architect|system design|ADR|domain|bounded context|microservice|architecture)\b/i,
  'security-engineer': /\b(security|vulnerability|CVE|injection|XSS|CSRF|OWASP)\b/i,
  'devops':      /\b(deploy|CI\/CD|docker|kubernetes|infra|devops|helm|terraform)\b/i,
  'technical-writer': /\b(document|readme|docs|api reference|jsdoc|write up)\b/i,
  'researcher':  /\b(research|investigate|explore|analyze|survey|compare)\b/i,
  'planner':     /\b(plan|roadmap|prioritize|breakdown|estimate)\b/i,
  'mobile-dev':  /\b(mobile|ios|android|react native|flutter)\b/i,
  'ai-engineer': /\b(ml|machine learning|neural network|model training|inference)\b/i,
  'backend-dev': /\b(api|rest|graphql|endpoint|http|websocket|grpc|optimize)\b/i,
  'frontend-dev': /\b(ui|frontend|react|vue|component|css|layout|style)\b/i,
  'coder':       /\b(bug|fix|error|exception|crash|broken|fail|regression|feature|implement|add|build|create|develop|new|memory|vector|embedding|hook|swarm|agent|mcp|cli|routing|monomind)\b/i,
};

var TASK_CONFIDENCES = {
  'tester':      0.85,
  'reviewer':    0.82,
  'architect':   0.85,
  'security-engineer': 0.90,
  'devops':      0.85,
  'technical-writer': 0.82,
  'researcher':  0.78,
  'planner':     0.80,
  'mobile-dev':  0.88,
  'ai-engineer': 0.85,
  'backend-dev': 0.80,
  'frontend-dev': 0.80,
  'coder':       0.80,
};

var TASK_AGENTS = {
  'tester':      'Tester',
  'reviewer':    'Reviewer',
  'architect':   'Architect',
  'security-engineer': 'Security Engineer',
  'devops':      'DevOps',
  'technical-writer': 'Technical Writer',
  'researcher':  'Researcher',
  'planner':     'Planner',
  'mobile-dev':  'Mobile Developer',
  'ai-engineer': 'AI Engineer',
  'backend-dev': 'Backend Developer',
  'frontend-dev': 'Frontend Developer',
  'coder':       'Coder',
};

// Priority order: higher-priority slugs checked first
var DEV_PRIORITY = [
  'tester', 'reviewer', 'architect', 'security-engineer', 'devops',
  'mobile-dev', 'ai-engineer', 'frontend-dev', 'backend-dev',
  'researcher', 'planner', 'technical-writer', 'coder',
];

// ── AGENT_CAPABILITIES ────────────────────────────────────────────────────────

var AGENT_CAPABILITIES = {
  'coder':         ['implement', 'fix', 'build', 'develop', 'create'],
  'tester':        ['test', 'spec', 'coverage', 'vitest', 'jest', 'e2e'],
  'reviewer':      ['review', 'audit', 'refactor', 'code quality', 'lint'],
  'researcher':    ['research', 'investigate', 'analyze', 'survey', 'compare'],
  'architect':     ['design', 'architecture', 'ADR', 'domain', 'microservice'],
  'planner':       ['plan', 'roadmap', 'strategy', 'prioritize', 'estimate'],
  'security-engineer': ['security', 'vulnerability', 'CVE', 'XSS', 'CSRF'],
  'backend-dev':   ['api', 'rest', 'graphql', 'endpoint', 'http', 'grpc'],
  'frontend-dev':  ['ui', 'frontend', 'react', 'css', 'component', 'layout'],
  'devops':        ['deploy', 'docker', 'kubernetes', 'CI/CD', 'terraform'],
  'mobile-dev':    ['mobile', 'ios', 'android', 'react native', 'flutter'],
  'ai-engineer':   ['ml', 'machine learning', 'model', 'neural', 'inference'],
  'technical-writer': ['docs', 'readme', 'document', 'jsdoc', 'api reference'],
};

// ── Non-dev domain agent registry ─────────────────────────────────────────────

var DOMAIN_AGENTS = [
  // Marketing
  { slug: 'content-strategist', name: 'Content Strategist', category: 'marketing',
    keywords: /\b(content|brand|blogging|copywriting|content strategy)\b/i },
  { slug: 'seo-specialist', name: 'SEO Specialist', category: 'marketing',
    keywords: /\b(seo|search engine|keyword research|backlink|organic traffic)\b/i },
  { slug: 'social-media-manager', name: 'Social Media Manager', category: 'marketing',
    keywords: /\b(social media|instagram|tiktok|twitter|linkedin|facebook|campaign)\b/i },
  { slug: 'marketing-analyst', name: 'Marketing Analyst', category: 'marketing',
    keywords: /\b(marketing|advertising|analytics|conversion|funnel|cpm|cpa)\b/i },

  // Sales
  { slug: 'sales-strategist', name: 'Sales Strategist', category: 'sales',
    keywords: /\b(sales|crm|lead generation|prospect|quota|sales revenue)\b/i },
  { slug: 'account-manager', name: 'Account Manager', category: 'sales',
    keywords: /\b(account management|client relationship|upsell|renewal|b2b)\b/i },

  // Academic
  { slug: 'academic-researcher', name: 'Academic Researcher', category: 'academic',
    keywords: /\b(anthropolog|ethnograph|kinship|cultural ritual|qualitative study|thesis|dissertation|peer review|academic)\b/i },
  { slug: 'data-scientist', name: 'Data Scientist', category: 'academic',
    keywords: /\b(statistical analysis|regression|hypothesis|p-value|dataset|R studio)\b/i },

  // Game development
  { slug: 'game-developer', name: 'Game Developer', category: 'game-development',
    keywords: /\b(unity|unreal|godot|game engine|shader|sprite|tilemap|game jam)\b/i },
  { slug: 'game-designer', name: 'Game Designer', category: 'game-development',
    keywords: /\b(game design|game mechanic|level design|player experience|narrative design)\b/i },

  // Legal / Finance
  { slug: 'legal-advisor', name: 'Legal Advisor', category: 'legal',
    keywords: /\b(legal|contract|compliance|regulation|gdpr|liability|intellectual property)\b/i },
  { slug: 'financial-analyst', name: 'Financial Analyst', category: 'finance',
    keywords: /\b(finance|investment|portfolio|valuation|balance sheet|ROI|P&L)\b/i },

  // HR / Operations
  { slug: 'hr-specialist', name: 'HR Specialist', category: 'hr',
    keywords: /\b(hiring|recruitment|onboarding|performance review|employee|hr|human resources)\b/i },
];

// Categories that are opt-in (only returned when keywords match)
var OPT_IN_CATEGORIES = new Set(['academic', 'game-development', 'legal', 'finance', 'hr']);

// Marketing is also opt-in — keywords must match
var MARKETING_OPTIN = /\b(marketing|seo|social media|advertising|campaign|content strategy|tiktok|instagram|brand)\b/i;

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

// ── Feedback weight system ────────────────────────────────────────────────────
// Reads routing-feedback.jsonl (written by session-handler at session-end) and
// computes per-agent success rates. Adjusts routing confidence by up to +/-0.10
// so agents with proven track records get a slight boost and poor performers get
// dampened. Cached with a 60-second TTL to avoid repeated disk reads.

var _feedbackWeightsCache = null;
var _feedbackWeightsCacheTs = 0;
var FEEDBACK_TTL_MS = 60000;

function loadFeedbackWeights() {
  var now = Date.now();
  if (_feedbackWeightsCache && (now - _feedbackWeightsCacheTs) < FEEDBACK_TTL_MS) {
    return _feedbackWeightsCache;
  }
  var weights = {};
  try {
    var fs = require('fs');
    var path = require('path');
    var cwd = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    var feedbackPath = path.join(cwd, '.monomind', 'routing-feedback.jsonl');
    var MAX_SIZE = 512 * 1024;
    if (!fs.existsSync(feedbackPath)) {
      _feedbackWeightsCache = weights;
      _feedbackWeightsCacheTs = now;
      return weights;
    }
    var stat = fs.statSync(feedbackPath);
    if (stat.size > MAX_SIZE) {
      _feedbackWeightsCache = weights;
      _feedbackWeightsCacheTs = now;
      return weights;
    }
    var lines = fs.readFileSync(feedbackPath, 'utf-8').trim().split('\n').filter(Boolean);
    // Use last 200 entries for weight calculation
    var recent = lines.slice(-200);
    var agentStats = {};
    for (var i = 0; i < recent.length; i++) {
      try {
        var entry = JSON.parse(recent[i]);
        var agent = entry.suggestedAgent;
        if (!agent) continue;
        // Skip no-evidence records (sessionSuccess null/missing) — they carry no signal
        if (typeof entry.intelligenceFeedback !== 'boolean') continue;
        if (!agentStats[agent]) agentStats[agent] = { total: 0, successes: 0 };
        agentStats[agent].total++;
        if (entry.intelligenceFeedback === true) agentStats[agent].successes++;
      } catch (e) {}
    }
    // Compute weight adjustments: agents with >= 5 data points get a weight
    // successRate > 0.7 → positive boost (up to +0.10)
    // successRate < 0.4 → negative dampen (down to -0.10)
    // In between → neutral (0)
    for (var ag in agentStats) {
      var s = agentStats[ag];
      if (s.total < 5) continue;
      var rate = s.successes / s.total;
      if (rate > 0.7) {
        weights[ag] = Math.min(0.10, (rate - 0.7) * 0.33);
      } else if (rate < 0.4) {
        weights[ag] = Math.max(-0.10, (rate - 0.4) * 0.25);
      }
    }
  } catch (e) { /* non-fatal */ }
  _feedbackWeightsCache = weights;
  _feedbackWeightsCacheTs = now;
  return weights;
}

function applyFeedbackWeight(agentSlug, baseConfidence) {
  var weights = loadFeedbackWeights();
  var adj = weights[agentSlug] || weights[TASK_AGENTS[agentSlug]] || 0;
  if (adj === 0) return baseConfidence;
  return Math.max(0, Math.min(1.0, baseConfidence + adj));
}

// ── Utilities ─────────────────────────────────────────────────────────────────

var MAX_PROMPT = 2000;

// ── routeTask ─────────────────────────────────────────────────────────────────

function routeTask(prompt) {
  // Empty / null → confidence 0
  if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
    return {
      agent: 'coder',
      agentSlug: 'coder',
      confidence: 0,
      reason: 'Default routing — empty input',
      semanticRouting: false,
      specificAgents: [],
      skillMatches: [],
      extrasMatches: [],
    };
  }

  var safePrompt = prompt.slice(0, MAX_PROMPT);

  // Skills are always checked — they're the primary value of routing now.
  var skills = matchSkills(safePrompt);

  // Check non-dev domain agents first (only if opt-in keywords match)
  var extras = matchExtras(safePrompt);
  if (extras.length > 0) {
    var topExtra = extras[0];
    return {
      agent: topExtra.name,
      agentSlug: topExtra.slug,
      confidence: applyFeedbackWeight(topExtra.slug, 0.80),
      reason: 'Domain: ' + topExtra.category,
      semanticRouting: false,
      specificAgents: extras,
      skillMatches: skills,
      extrasMatches: extras,
    };
  }

  // Check if a skill matched strongly (score >= 2) — if so, skip broad catch-all agents
  var hasStrongSkill = false;
  for (var si = 0; si < skills.length; si++) {
    if (skills[si].score >= 2) { hasStrongSkill = true; break; }
  }

  // Check dev patterns in priority order
  for (var i = 0; i < DEV_PRIORITY.length; i++) {
    var slug = DEV_PRIORITY[i];
    // Skip the broad "coder" catch-all when a specialized skill matched strongly
    if (slug === 'coder' && hasStrongSkill) continue;
    var pattern = _ROUTING_PATTERNS[slug];
    if (pattern && pattern.test(safePrompt)) {
      // Count how many distinct keywords from the pattern actually matched
      // so confidence reflects real match quality, not just a static constant.
      var caps = AGENT_CAPABILITIES[slug] || [];
      var promptLower = safePrompt.toLowerCase();
      var matchedKw = 0;
      for (var ki = 0; ki < caps.length; ki++) {
        if (promptLower.indexOf(caps[ki].toLowerCase()) !== -1) matchedKw++;
      }
      var baseConf = TASK_CONFIDENCES[slug] || 0.75;
      var matchBonus = Math.min(0.10, matchedKw * 0.02);
      var confidence = Math.min(0.98, applyFeedbackWeight(slug, baseConf + matchBonus));
      return {
        agent: TASK_AGENTS[slug],
        agentSlug: slug,
        confidence: confidence,
        reason: ('Keyword match: ' + slug + ' (' + matchedKw + ' kw)').slice(0, 80),
        semanticRouting: false,
        specificAgents: [{ slug: slug, name: TASK_AGENTS[slug], confidence: confidence }],
        skillMatches: skills,
        extrasMatches: [],
      };
    }
  }

  // No match → default
  return {
    agent: 'coder',
    agentSlug: 'coder',
    confidence: 0.5,
    reason: 'Default routing — no strong keyword match',
    semanticRouting: false,
    specificAgents: [],
    skillMatches: skills,
    extrasMatches: [],
  };
}

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

// ── matchExtras ────────────────────────────────────────────────────────────────

function matchExtras(prompt, topN) {
  if (!prompt || typeof prompt !== 'string') return [];
  topN = topN || 8;
  var safePrompt = prompt.slice(0, MAX_PROMPT);

  var scored = [];
  for (var i = 0; i < DOMAIN_AGENTS.length; i++) {
    var a = DOMAIN_AGENTS[i];
    if (!a.keywords.test(safePrompt)) continue;

    // Opt-in categories: only include if keywords explicitly match
    if (OPT_IN_CATEGORIES.has(a.category)) {
      scored.push({ slug: a.slug, name: a.name, category: a.category, score: 1.0 });
      continue;
    }

    // Marketing is opt-in too
    if (a.category === 'marketing') {
      if (MARKETING_OPTIN.test(safePrompt)) {
        scored.push({ slug: a.slug, name: a.name, category: a.category, score: 1.0 });
      }
      continue;
    }

    // Sales: only include when sales keywords match
    scored.push({ slug: a.slug, name: a.name, category: a.category, score: 1.0 });
  }

  scored.sort(function(a, b) { return b.score - a.score; });
  return scored.slice(0, topN);
}

// ── buildCategoryList ─────────────────────────────────────────────────────────

function buildCategoryList() {
  var catMap = {};
  for (var i = 0; i < DOMAIN_AGENTS.length; i++) {
    var a = DOMAIN_AGENTS[i];
    if (!catMap[a.category]) catMap[a.category] = { name: a.category, count: 0, examples: [] };
    catMap[a.category].count++;
    if (catMap[a.category].examples.length < 3) catMap[a.category].examples.push(a.slug);
  }
  return Object.values(catMap);
}

// ── getAgentsInCategory ────────────────────────────────────────────────────────

function getAgentsInCategory(category) {
  if (!category || typeof category !== 'string') return [];
  return DOMAIN_AGENTS
    .filter(function(a) { return a.category === category; })
    .map(function(a) { return { slug: a.slug, name: a.name }; });
}

// ── exports ────────────────────────────────────────────────────────────────────

module.exports = {
  routeTask: routeTask,
  routeTaskSemantic: routeTask,
  matchSkills: matchSkills,
  matchExtras: matchExtras,
  buildCategoryList: buildCategoryList,
  getAgentsInCategory: getAgentsInCategory,
  AGENT_CAPABILITIES: AGENT_CAPABILITIES,
  TASK_PATTERNS: TASK_PATTERNS,
};
