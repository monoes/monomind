#!/usr/bin/env node
/**
 * Monomind Agent Router
 * Routes tasks to optimal agents based on learned patterns.
 * Also does keyword-matching against skill-registry.json (dev skills)
 * and extras-registry.json (non-dev specialist agents).
 */

const path = require('path');
const fs = require('fs');

const AGENT_CAPABILITIES = {
  coder: ['code-generation', 'refactoring', 'debugging', 'implementation'],
  tester: ['unit-testing', 'integration-testing', 'coverage', 'test-generation'],
  reviewer: ['code-review', 'security-audit', 'quality-check', 'best-practices'],
  researcher: ['web-search', 'documentation', 'analysis', 'summarization'],
  architect: ['system-design', 'architecture', 'patterns', 'scalability'],
  'backend-dev': ['api', 'database', 'server', 'authentication'],
  'frontend-dev': ['ui', 'react', 'css', 'components'],
  devops: ['ci-cd', 'docker', 'deployment', 'infrastructure'],
};

// Maps generic role → specific specialized agents available in the system
const SPECIFIC_AGENTS_MAP = {
  coder: [
    { slug: 'sparc-coder',       label: 'sparc-coder',        note: 'TDD + SPARC methodology' },
    { slug: 'backend-dev',       label: 'backend-dev',         note: 'API, DB, server-side' },
    { slug: 'frontend-dev',      label: 'Frontend Developer',  note: 'React/Vue/CSS' },
    { slug: 'mobile-dev',        label: 'mobile-dev',          note: 'React Native iOS/Android' },
    { slug: 'ml-developer',      label: 'ml-developer',        note: 'ML model dev & training' },
  ],
  tester: [
    { slug: 'tdd-london-swarm',      label: 'tdd-london-swarm',       note: 'Mock-driven TDD' },
    { slug: 'API Tester',            label: 'API Tester',              note: 'API validation & performance' },
    { slug: 'production-validator',  label: 'production-validator',    note: 'Deployment readiness' },
    { slug: 'Evidence Collector',    label: 'Evidence Collector',      note: 'Screenshot-backed QA' },
    { slug: 'agent-browser-testing', label: 'agent-browser-testing',   note: 'UI/browser automation testing' },
  ],
  reviewer: [
    { slug: 'Code Reviewer',              label: 'Code Reviewer',            note: 'Correctness, security, perf' },
    { slug: 'code-analyzer',              label: 'code-analyzer',            note: 'Quality metrics & smells' },
    { slug: 'feature-dev:code-reviewer',  label: 'feature-dev:code-reviewer',note: 'Bug & logic error detection' },
    { slug: 'Reality Checker',            label: 'Reality Checker',          note: 'Evidence-based certification' },
    { slug: 'Accessibility Auditor',      label: 'Accessibility Auditor',    note: 'WCAG & assistive tech' },
  ],
  researcher: [
    { slug: 'sparc:researcher',  label: 'sparc:researcher',  note: 'Parallel web search + memory' },
    { slug: 'Explore',           label: 'Explore',            note: 'Fast codebase exploration' },
    { slug: 'Trend Researcher',  label: 'Trend Researcher',   note: 'Market intelligence' },
    { slug: 'UX Researcher',     label: 'UX Researcher',      note: 'User behaviour & usability' },
  ],
  architect: [
    { slug: 'system-architect',   label: 'system-architect',   note: 'High-level system design' },
    { slug: 'Software Architect', label: 'Software Architect',  note: 'DDD, patterns, decisions' },
    { slug: 'Backend Architect',  label: 'Backend Architect',   note: 'Scalable server-side design' },
    { slug: 'Plan',               label: 'Plan',                note: 'Implementation strategy' },
  ],
  'backend-dev': [
    { slug: 'backend-dev',        label: 'backend-dev',         note: 'API & server patterns' },
    { slug: 'Database Optimizer', label: 'Database Optimizer',  note: 'Schema, indexes, query tuning' },
    { slug: 'Data Engineer',      label: 'Data Engineer',       note: 'Pipelines, ETL, lakehouse' },
    { slug: 'Security Engineer',  label: 'Security Engineer',   note: 'Threat modelling, secure code' },
  ],
  'frontend-dev': [
    { slug: 'Frontend Developer', label: 'Frontend Developer',  note: 'React/Vue/Angular' },
    { slug: 'UI Designer',        label: 'UI Designer',          note: 'Design systems & components' },
    { slug: 'UX Architect',       label: 'UX Architect',         note: 'CSS systems & interaction' },
    { slug: 'mobile-dev',         label: 'mobile-dev',           note: 'Cross-platform mobile' },
  ],
  devops: [
    { slug: 'DevOps Automator',   label: 'DevOps Automator',    note: 'CI/CD, infra automation' },
    { slug: 'SRE',                label: 'SRE',                  note: 'SLOs, reliability, on-call' },
    { slug: 'cicd-engineer',      label: 'cicd-engineer',        note: 'GitHub Actions pipelines' },
    { slug: 'Incident Response Commander', label: 'Incident Response Commander', note: 'Prod incident mgmt' },
  ],
};

const TASK_PATTERNS = {
  '\\bimplement\\b|\\bcreate\\b|\\bbuild\\b|\\badd\\b|\\bwrite\\s+code\\b': 'coder',
  '\\btest\\b|\\bspec\\b|\\bcoverage\\b|unit test|\\bintegration\\b': 'tester',
  '\\breview\\b|\\baudit\\b|\\bcheck\\b|\\bvalidate\\b|\\bsecurity\\b': 'reviewer',
  '\\bresearch\\b|\\bfind\\b|\\bsearch\\b|\\bdocumentation\\b|\\bexplore\\b|\\bexplain\\b|\\bunderstand\\b|\\bhow does\\b|\\bhow do\\b|\\bwhat is\\b': 'researcher',
  '\\bdesign\\b|\\barchitect\\b|\\bstructure\\b|\\bplan\\b': 'architect',
  '\\bapi\\b|\\bendpoint\\b|\\bserver\\b|\\bbackend\\b|\\bdatabase\\b': 'backend-dev',
  '\\bui\\b|\\bfrontend\\b|\\bcomponent\\b|\\breact\\b|\\bcss\\b|\\bstyle\\b': 'frontend-dev',
  '\\bdeploy\\b|\\bdocker\\b|\\bci\\b|\\bcd\\b|\\bpipeline\\b|\\binfrastructure\\b': 'devops',
};

// Non-dev domain keywords — if matched, skip dev routing and go to extras
const NON_DEV_PATTERNS = [
  'marketing', 'campaign', 'social media', 'tiktok', 'instagram', 'twitter', 'linkedin',
  'seo', 'content creation', 'viral', 'growth hacking', 'brand', 'influencer', 'ecommerce',
  'sales', 'crm', 'sales pipeline', 'leads', 'prospects', 'quota', 'outbound',
  'paid media', 'ppc', 'google ads', 'facebook ads', 'programmatic', 'display ads',
  'product management', 'product roadmap', 'sprint', 'backlog', 'user story', 'customer feedback',
  'project management', 'milestone', 'stakeholder', 'jira', 'agile', 'scrum',
  'ux research', 'user research', 'usability', 'wireframe', 'prototype', 'figma',
  'ui design', 'visual design', 'illustration', 'branding',
  'academic', 'anthropology', 'history', 'geography', 'psychology', 'narrative theory',
  'blockchain', 'salesforce', 'healthcare', 'compliance', 'supply chain',
  'recruitment', 'hiring', 'human resources', 'finance tracking', 'invoice', 'executive summary',
  'customer support', 'helpdesk', 'podcast', 'video editing', 'short video',
];

// ─── Skill registry (dev skills) ────────────────────────────────────────────
let _skillRegistry = null;
function loadSkillRegistry() {
  if (_skillRegistry) return _skillRegistry;
  try {
    _skillRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, 'skill-registry.json'), 'utf8'));
  } catch (e) { _skillRegistry = { skills: [] }; }
  return _skillRegistry;
}

// ─── Extras registry (non-dev agents) ───────────────────────────────────────
let _extrasRegistry = null;
function loadExtrasRegistry() {
  if (_extrasRegistry) return _extrasRegistry;
  try {
    _extrasRegistry = JSON.parse(fs.readFileSync(path.join(__dirname, 'extras-registry.json'), 'utf8'));
  } catch (e) { _extrasRegistry = { extras: [] }; }
  return _extrasRegistry;
}

// ─── Scoring helpers ─────────────────────────────────────────────────────────
function scoreEntry(keywords, taskLower) {
  if (!Array.isArray(keywords)) return 0;
  let score = 0;
  for (const kw of keywords) {
    if (typeof kw === 'string' && taskLower.includes(kw.toLowerCase())) score++;
  }
  return score;
}

function matchSkills(task, topN = 5) {
  if (typeof task !== 'string') return [];
  const registry = loadSkillRegistry();
  const taskLower = task.toLowerCase();
  return registry.skills
    .map(s => ({ skill: s.skill, invoke: s.invoke, description: s.description, category: s.category, score: scoreEntry(s.keywords, taskLower) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Categories that are almost never relevant in a software project context.
// We exclude these from extras suggestions UNLESS the prompt has explicit
// keywords that opt them back in. Default-conservative: in a code repo,
// an "Anthropologist" for "community docs" or "Unity Architect" for a
// "community module" is noise, not signal.
const _NON_DEV_EXTRA_CATEGORIES = new Set([
  'academic',         // Anthropologist, Geographer, Historian, Narratologist, Psychologist
  'game-development', // Unity/Unreal/Godot/Blender — irrelevant for non-game codebases
  'marketing',
  'sales',
  'paid-media',
  'design',           // brand/UI/UX specialists — irrelevant for code reviews
]);

// Per-category opt-in keywords. If the prompt mentions one of these, that
// category is allowed back into extras.
const _CATEGORY_OPTIN_KEYWORDS = {
  'academic':         /\b(anthropolog|sociolog|cultural|ritual|kinship|ethnograph|histor(?:y|ical|ian)|geograph|narratolog|psycholog|belief\s*system)\b/i,
  'game-development': /\b(unity|unreal|godot|blender|game\s*(?:design|dev|engine)|gameplay|shader\s*graph|level\s*design|ugc|roblox)\b/i,
  'marketing':        /\b(marketing|advertis|seo|tiktok|instagram|linkedin\s*content|brand|campaign|growth\s*hack|copywrit|blog\s*post|press\s*release|launch\s*strategy|pitch|investor)\b/i,
  'sales':            /\b(sales|prospect|outbound|pipeline|crm|cold\s*email|deal|account\s*strategy|quota|forecast|qbr)\b/i,
  'paid-media':       /\b(paid\s*media|ads?|google\s*ads|meta\s*ads|programmatic|ppc|cpa|conversion\s*tracking)\b/i,
  'design':           /\b(figma|brand\s*identity|design\s*system|ux\s*research|persona|usability|wireframe|prototype|color\s*palette|typography|moodboard)\b/i,
};

function _allowedExtraCategories(taskLower) {
  const allowed = new Set();
  for (const [cat, re] of Object.entries(_CATEGORY_OPTIN_KEYWORDS)) {
    if (re.test(taskLower)) allowed.add(cat);
  }
  return allowed;
}

function matchExtras(task, topN = 8) {
  if (typeof task !== 'string') return [];
  const registry = loadExtrasRegistry();
  const taskLower = task.toLowerCase();
  const optedIn = _allowedExtraCategories(taskLower);
  return registry.extras
    .filter(e => !_NON_DEV_EXTRA_CATEGORIES.has(e.category) || optedIn.has(e.category))
    .map(e => ({ slug: e.slug, name: e.name, description: e.description, category: e.category, filePath: e.filePath, score: scoreEntry(e.keywords, taskLower) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

// Pre-compiled word-boundary regexes for non-dev patterns (built once at load time)
const _nonDevRegexes = NON_DEV_PATTERNS.map(function(kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp('\\b' + escaped + '\\b', 'i');
});

function isNonDevTask(taskLower) {
  for (const re of _nonDevRegexes) {
    if (re.test(taskLower)) return true;
  }
  return false;
}

// ─── Two-Stage Keyword Router (for non-dev and ambiguous tasks) ──────────────
// Stage 1: pick best category by scoring task tokens against category keywords
// Stage 2: pick best agent within that category by keyword overlap
// Pure in-process — no external API calls, no API key required.

function buildCategoryList() {
  const registry = loadExtrasRegistry();
  const cats = {};
  for (const e of registry.extras) {
    if (!cats[e.category]) cats[e.category] = [];
    cats[e.category].push(e.name);
  }
  return Object.entries(cats).map(([name, agents]) => ({
    name,
    count: agents.length,
    examples: agents.slice(0, 4).join(', '),
  }));
}

function getAgentsInCategory(category) {
  const registry = loadExtrasRegistry();
  return registry.extras
    .filter(e => e.category === category)
    .map(e => ({ slug: e.slug, name: e.name, description: (e.description || '').slice(0, 120) }));
}

// Score a task string against an agent entry using keyword overlap
function scoreAgainstEntry(taskTokens, entry) {
  let score = 0;
  const nameTokens = (entry.name || '').toLowerCase().split(/\W+/).filter(Boolean);
  const descTokens = (entry.description || '').toLowerCase().split(/\W+/).filter(Boolean);
  const kwTokens = Array.isArray(entry.keywords) ? entry.keywords.map(k => k.toLowerCase()) : [];
  const allTokens = new Set([...nameTokens, ...descTokens, ...kwTokens]);
  for (const t of taskTokens) {
    if (allTokens.has(t)) score += 2;
    else for (const s of allTokens) { if (s.includes(t) || t.includes(s)) { score += 1; break; } }
  }
  return score;
}

// Category-level score: sum agent scores within the category
function scoreCategoryForTask(taskTokens, category, registry) {
  const agents = registry.extras.filter(e => e.category === category);
  return agents.reduce((sum, e) => sum + scoreAgainstEntry(taskTokens, e), 0);
}

async function routeTaskLLM(task) {
  const registry = loadExtrasRegistry();
  if (!registry.extras.length) return null;

  const taskLower = task.toLowerCase();
  const STOP = new Set(['the','and','for','are','but','not','you','all','can','had','her','was','one','our','out','day','get','has','him','his','how','its','may','new','now','old','see','two','way','who','did','let','put','say','she','too','use','will','with','that','this','from','they','been','have','make','then','than','when','what','does','into','your']);
  const taskTokens = taskLower.split(/\W+/).filter(w => w.length > 3 && !STOP.has(w));

  // Stage 1: pick best category by aggregate keyword score
  const categories = [...new Set(registry.extras.map(e => e.category))];
  const catScores = categories.map(cat => ({
    cat,
    score: scoreCategoryForTask(taskTokens, cat, registry),
  })).sort((a, b) => b.score - a.score);

  const bestCat = catScores[0];
  if (!bestCat || bestCat.score === 0) return null;

  // Stage 2: pick best agent within the category
  const candidates = registry.extras.filter(e => e.category === bestCat.cat);
  const scored = candidates.map(e => ({ e, score: scoreAgainstEntry(taskTokens, e) }))
    .sort((a, b) => b.score - a.score);

  const top = scored[0];
  if (!top || top.score === 0) return null;

  const allInCat = candidates.map(e => ({ slug: e.slug, label: e.name, note: e.category }));
  return {
    agent: top.e.name,
    agentSlug: top.e.slug,
    confidence: Math.min(0.85, 0.5 + top.score * 0.05),
    reason: `Keyword 2-stage: ${bestCat.cat} → ${top.e.name}`,
    category: bestCat.cat,
    allInCategory: allInCat,
  };
}

/**
 * Route multiple subtasks for swarm agent selection.
 * Each subtask description gets its own 2-stage LLM routing.
 * Returns array of { subtask, agent, agentSlug, confidence, reason }.
 */
async function routeSwarmAgents(subtasks) {
  if (!Array.isArray(subtasks) || !subtasks.length) return [];
  const results = await Promise.all(subtasks.map(async (sub) => {
    const desc = typeof sub === 'string' ? sub : sub.description || sub.task || '';
    if (!desc) return { subtask: desc, agent: 'coder', agentSlug: 'coder', confidence: 0.5, reason: 'empty subtask' };
    const llm = await routeTaskLLM(desc);
    if (llm) return { subtask: desc, agent: llm.agent, agentSlug: llm.agentSlug, confidence: llm.confidence, reason: llm.reason };
    const kw = routeTask(desc);
    return { subtask: desc, agent: kw.agent, agentSlug: kw.agentSlug, confidence: kw.confidence, reason: kw.reason };
  }));
  return results;
}

// ─── RouteLayer bridge (GAP-002) ─────────────────────────────────────────────
// Cache a Promise so concurrent callers all await the same load operation.
var _routeLayerPromise = null;

async function tryLoadRouteLayer() {
  if (!_routeLayerPromise) {
    _routeLayerPromise = (async function() {
      try {
        var routingModule = await import('@monomind/routing');
        if (routingModule && routingModule.RouteLayer && routingModule.ALL_ROUTES) {
          return new routingModule.RouteLayer({ routes: routingModule.ALL_ROUTES });
        }
      } catch (e) { /* @monomind/routing not compiled — keyword fallback will be used */ }
      return null;
    })();
  }
  return _routeLayerPromise;
}

/**
 * Async variant — tries LLM 2-stage routing for non-dev tasks,
 * RouteLayer semantic routing for dev tasks, falls back to keywords.
 */
async function routeTaskSemantic(task) {
  if (typeof task !== 'string' || !task) return routeTask(task);
  const taskLower = task.toLowerCase();

  // For non-dev tasks or ambiguous defaults, try LLM 2-stage routing first
  if (isNonDevTask(taskLower)) {
    const llmResult = await routeTaskLLM(task);
    if (llmResult) {
      const extrasMatches = matchExtras(task);
      return {
        agent: llmResult.agent,
        agentSlug: llmResult.agentSlug,
        confidence: llmResult.confidence,
        reason: llmResult.reason,
        skillMatches: [],
        extrasMatches,
        specificAgents: llmResult.allInCategory.slice(0, 5),
        llmRouting: true,
      };
    }
    // LLM failed — fall through to keyword-based extras matching
  }

  // Dev tasks: try RouteLayer semantic routing
  const rl = await tryLoadRouteLayer();
  if (rl && rl.route) {
    try {
      const semantic = await rl.route(task);
      if (semantic && semantic.agentSlug && semantic.confidence > 0.6) {
        const mapEntry = SPECIFIC_AGENTS_MAP[semantic.agentSlug];
        const isDevDomain = !!(mapEntry && mapEntry.length > 0);
        const extrasForTask = isDevDomain ? [] : matchExtras(task);
        const semanticSpecificAgents = (mapEntry && mapEntry.length > 0)
          ? mapEntry
          : extrasForTask.slice(0, 5).map(e => ({ slug: e.slug, label: e.name, note: e.category }));
        return {
          agent: semantic.agentSlug,
          agentSlug: semantic.agentSlug,
          confidence: semantic.confidence,
          reason: 'RouteLayer semantic (' + (semantic.method || 'semantic') + '): ' + semantic.routeName,
          skillMatches: matchSkills(task),
          extrasMatches: extrasForTask,
          specificAgents: semanticSpecificAgents,
          semanticRouting: true,
        };
      }
    } catch (e) { /* fall through to keyword */ }
  }

  // Default keyword fallback — also try LLM if no dev pattern matched
  const keywordResult = routeTask(task);
  if (keywordResult.confidence <= 0.5) {
    const llmResult = await routeTaskLLM(task);
    if (llmResult) {
      return {
        agent: llmResult.agent,
        agentSlug: llmResult.agentSlug,
        confidence: llmResult.confidence,
        reason: llmResult.reason,
        skillMatches: keywordResult.skillMatches,
        extrasMatches: matchExtras(task),
        specificAgents: llmResult.allInCategory.slice(0, 5),
        llmRouting: true,
      };
    }
  }
  return keywordResult;
}

// ─── Feedback weight loader ───────────────────────────────────────────────────
// Reads .monomind/routing-feedback.jsonl to compute per-agent success-rate
// weights. Weights are memoized with a 60-second TTL.
//
// Signal source: routing-feedback.jsonl entries where intelligenceFeedback is
// non-null. Currently most entries have intelligenceFeedback: null (the field
// is written by hook-handler but real outcomes are not yet propagated from
// intelligence.feedback()/post-task hooks back to this file).
//
// TODO: wire the post-task outcome from intelligence.cjs::feedback() into
// routing-feedback.jsonl to activate real signal. Until then, weights stay at
// 1.0 for agents with no non-null feedback entries.
//
// To verify: copy .monomind/test-fixtures/routing-feedback-seeded.jsonl to
// .monomind/routing-feedback.jsonl, then call loadFeedbackWeights() in a REPL.

var _feedbackWeightsCache = null;
var _feedbackWeightsCacheTime = 0;
var FEEDBACK_CACHE_TTL_MS = 60000;
var MIN_FEEDBACK_SAMPLES = 10;

function loadFeedbackWeights() {
  var now = Date.now();
  if (_feedbackWeightsCache && now - _feedbackWeightsCacheTime < FEEDBACK_CACHE_TTL_MS) {
    return _feedbackWeightsCache;
  }
  var feedbackPath = path.join(process.cwd(), '.monomind', 'routing-feedback.jsonl');
  if (!fs.existsSync(feedbackPath)) {
    _feedbackWeightsCache = new Map();
    _feedbackWeightsCacheTime = now;
    return _feedbackWeightsCache;
  }
  var lines;
  try {
    lines = fs.readFileSync(feedbackPath, 'utf8').trim().split('\n').filter(Boolean);
  } catch {
    _feedbackWeightsCache = new Map();
    _feedbackWeightsCacheTime = now;
    return _feedbackWeightsCache;
  }
  // SCAFFOLD: feedback weights are scaffolded and inactive.
  // intelligenceFeedback in routing-feedback.jsonl is not yet written with real signal.
  // Activation path: hook-handler.cjs session-end must write intelligenceFeedback from
  // intelligence-outcomes.jsonl to the current session's routing-feedback.jsonl entry.
  // Until then, weights Map is always empty and routing is unaffected.
  var agentStats = {};
  for (var i = 0; i < lines.length; i++) {
    try {
      var entry = JSON.parse(lines[i]);
      var agent = entry.suggestedAgent || entry.agent;
      if (!agent) continue;
      if (!agentStats[agent]) agentStats[agent] = { total: 0, successTotal: 0, withSignal: 0 };
      agentStats[agent].total++;
      // Only count entries where intelligenceFeedback is non-null as having signal
      var fb = entry.intelligenceFeedback;
      if (fb !== null && fb !== undefined) {
        agentStats[agent].withSignal++;
        var success = fb === true || (fb && fb.success === true);
        if (success) agentStats[agent].successTotal++;
      }
    } catch { /* skip malformed lines */ }
  }
  var weights = new Map();
  for (var agentName in agentStats) {
    var stats = agentStats[agentName];
    // Only activate weight when we have enough non-null signal entries
    if (stats.withSignal >= MIN_FEEDBACK_SAMPLES) {
      var rate = stats.successTotal / stats.withSignal;
      // Clamp to [0.5, 1.5]: bad agents get penalized, good agents boosted slightly
      weights.set(agentName, Math.max(0.5, Math.min(1.5, rate * 2)));
    }
  }
  _feedbackWeightsCache = weights;
  _feedbackWeightsCacheTime = now;
  return weights;
}

// ─── Main routing ─────────────────────────────────────────────────────────────
function routeTask(task) {
  if (typeof task !== 'string' || !task) {
    return { agent: 'coder', agentSlug: 'coder', confidence: 0, reason: 'Empty task', skillMatches: [], extrasMatches: [], specificAgents: SPECIFIC_AGENTS_MAP['coder'] || [] };
  }
  const taskLower = task.toLowerCase();

  // Check non-dev first — resolve to the top-matched specialist agent name (never "extras")
  if (isNonDevTask(taskLower)) {
    const extrasMatches = matchExtras(task);
    const top = extrasMatches[0];
    const agentName = top ? top.name : 'Specialist Agent';
    const agentSlug = top ? top.slug : 'specialist-agent';
    return {
      agent: agentName,
      agentSlug: agentSlug,
      confidence: top ? 0.85 : 0.5,
      reason: 'Domain: ' + (top ? top.category : 'non-dev') + ' | /specialagent',
      skillMatches: [],
      extrasMatches,
      specificAgents: extrasMatches.slice(0, 5).map(e => ({ slug: e.slug, label: e.name, note: e.category })),
    };
  }

  var feedbackWeights = loadFeedbackWeights();

  // Dev task pattern matching
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      // Apply feedback weight to confidence (defaults to 1.0 = no change)
      var baseConfidence = 0.8;
      var weight = feedbackWeights.get(agent) || 1.0;
      return {
        agent,
        agentSlug: agent,
        confidence: Math.min(1.0, baseConfidence * weight),
        reason: `Matched pattern: ${pattern}`,
        skillMatches: matchSkills(task),
        extrasMatches: [],
        specificAgents: SPECIFIC_AGENTS_MAP[agent] || [],
      };
    }
  }

  // Default — low confidence, show both skill and extras suggestions
  var defaultAgent = 'coder';
  var defaultWeight = feedbackWeights.get(defaultAgent) || 1.0;
  return {
    agent: defaultAgent,
    agentSlug: defaultAgent,
    confidence: Math.min(1.0, 0.5 * defaultWeight),
    reason: 'Default routing - no specific pattern matched',
    skillMatches: matchSkills(task),
    extrasMatches: matchExtras(task),
    specificAgents: SPECIFIC_AGENTS_MAP[defaultAgent] || [],
  };
}

/**
 * Load the full text of an extras agent by slug.
 * Used when Claude picks an agent to activate.
 */
function loadExtrasAgent(slug) {
  if (typeof slug !== 'string' || !slug) return null;
  const registry = loadExtrasRegistry();
  const slugLower = slug.toLowerCase();
  const entry = registry.extras.find(e =>
    e.slug === slug || (typeof e.name === 'string' && e.name.toLowerCase() === slugLower)
  );
  if (!entry) return null;
  try {
    const resolvedPath = path.isAbsolute(entry.filePath)
      ? entry.filePath
      : path.resolve(__dirname, entry.filePath);
    return { ...entry, content: fs.readFileSync(resolvedPath, 'utf8') };
  } catch (e) { return null; }
}

module.exports = { routeTask, routeTaskSemantic, routeTaskLLM, routeSwarmAgents, matchSkills, matchExtras, loadExtrasAgent, loadExtrasRegistry, loadSkillRegistry, buildCategoryList, getAgentsInCategory, AGENT_CAPABILITIES, TASK_PATTERNS };

// CLI
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--load-agent') {
    const agent = loadExtrasAgent(args.slice(1).join(' '));
    if (agent) { console.log(agent.content); }
    else { console.error('Agent not found'); process.exit(1); }
  } else if (args.length) {
    const result = routeTask(args.join(' '));
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log('Usage: router.cjs <task>  OR  router.cjs --load-agent <slug>');
  }
}
