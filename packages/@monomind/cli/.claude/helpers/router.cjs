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

var SKILLS = [
  { skill: 'mastermind', invoke: '/mastermind', description: 'Select swarm topology', keywords: /\b(swarm|topology|hive|mastermind|multi.agent)\b/i },
  { skill: 'monodesign', invoke: '/monodesign', description: 'Frontend design and UI', keywords: /\b(design|ui|ux|component|visual|layout|css|theme)\b/i },
  { skill: 'monomotion', invoke: '/monomotion', description: 'Web animations and motion', keywords: /\b(animate|animation|motion|gsap|transition|scroll)\b/i },
  { skill: 'graphify', invoke: '/graphify', description: 'Input to knowledge graph', keywords: /\b(graph|knowledge|monograph|node|edge|visualize)\b/i },
];

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

  // Check non-dev domain agents first (only if opt-in keywords match)
  var extras = matchExtras(safePrompt);
  if (extras.length > 0) {
    var topExtra = extras[0];
    return {
      agent: topExtra.name,
      agentSlug: topExtra.slug,
      confidence: 0.80,
      reason: 'Domain: ' + topExtra.category,
      semanticRouting: false,
      specificAgents: extras,
      skillMatches: [],
      extrasMatches: extras,
    };
  }

  // Check dev patterns in priority order
  for (var i = 0; i < DEV_PRIORITY.length; i++) {
    var slug = DEV_PRIORITY[i];
    var pattern = _ROUTING_PATTERNS[slug];
    if (pattern && pattern.test(safePrompt)) {
      var confidence = TASK_CONFIDENCES[slug] || 0.75;
      var skills = matchSkills(safePrompt);
      return {
        agent: TASK_AGENTS[slug],
        agentSlug: slug,
        confidence: confidence,
        reason: ('Keyword match: ' + slug).slice(0, 80),
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
    skillMatches: [],
    extrasMatches: [],
  };
}

// ── matchSkills ────────────────────────────────────────────────────────────────

function matchSkills(prompt, topN) {
  if (!prompt || typeof prompt !== 'string') return [];
  topN = topN || 5;
  var safePrompt = prompt.slice(0, MAX_PROMPT);

  var scored = [];
  for (var i = 0; i < SKILLS.length; i++) {
    var s = SKILLS[i];
    if (s.keywords.test(safePrompt)) {
      scored.push({ skill: s.skill, invoke: s.invoke, description: s.description, score: 1.0 });
    }
  }

  scored.sort(function(a, b) { return b.score - a.score; });
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
