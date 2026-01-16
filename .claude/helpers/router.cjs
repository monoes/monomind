#!/usr/bin/env node
/**
 * Monobrain Agent Router
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

const TASK_PATTERNS = {
  'implement|create|build|add|write code': 'coder',
  'test|spec|coverage|unit test|integration': 'tester',
  'review|audit|check|validate|security': 'reviewer',
  'research|find|search|documentation|explore|explain|understand|how does|how do|what is': 'researcher',
  'design|architect|structure|plan': 'architect',
  'api|endpoint|server|backend|database': 'backend-dev',
  'ui|frontend|component|react|css|style': 'frontend-dev',
  'deploy|docker|ci|cd|pipeline|infrastructure': 'devops',
};

// Non-dev domain keywords — if matched, skip dev routing and go to extras
const NON_DEV_PATTERNS = [
  'marketing', 'campaign', 'social media', 'tiktok', 'instagram', 'twitter', 'linkedin',
  'seo', 'content creation', 'viral', 'growth hacking', 'brand', 'influencer', 'ecommerce',
  'sales', 'crm', 'pipeline', 'leads', 'prospects', 'quota', 'deal', 'closing', 'outbound',
  'paid media', 'ppc', 'google ads', 'facebook ads', 'programmatic', 'display ads',
  'product management', 'roadmap', 'sprint', 'backlog', 'user story', 'customer feedback',
  'project management', 'milestone', 'stakeholder', 'jira', 'agile', 'scrum',
  'ux research', 'user research', 'usability', 'wireframe', 'prototype', 'figma',
  'ui design', 'visual design', 'illustration', 'branding',
  'academic', 'anthropology', 'history', 'geography', 'psychology', 'narrative theory',
  'blockchain', 'salesforce', 'healthcare', 'compliance', 'legal', 'supply chain',
  'recruitment', 'hiring', 'hr', 'finance tracking', 'invoice', 'executive summary',
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
  let score = 0;
  for (const kw of keywords) {
    if (taskLower.includes(kw.toLowerCase())) score++;
  }
  return score;
}

function matchSkills(task, topN = 5) {
  const registry = loadSkillRegistry();
  const taskLower = task.toLowerCase();
  return registry.skills
    .map(s => ({ skill: s.skill, invoke: s.invoke, description: s.description, category: s.category, score: scoreEntry(s.keywords, taskLower) }))
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function matchExtras(task, topN = 8) {
  const registry = loadExtrasRegistry();
  const taskLower = task.toLowerCase();
  return registry.extras
    .map(e => ({ slug: e.slug, name: e.name, description: e.description, category: e.category, filePath: e.filePath, score: scoreEntry(e.keywords, taskLower) }))
    .filter(e => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

function isNonDevTask(taskLower) {
  for (const kw of NON_DEV_PATTERNS) {
    if (taskLower.includes(kw)) return true;
  }
  return false;
}

// ─── RouteLayer bridge (GAP-002) ─────────────────────────────────────────────
// Cache the RouteLayer instance once loaded so subsequent calls are fast.
var _routeLayer = null;
var _routeLayerLoading = false;

async function tryLoadRouteLayer() {
  if (_routeLayer || _routeLayerLoading) return _routeLayer;
  _routeLayerLoading = true;
  try {
    var routingModule = await import('@monobrain/routing');
    if (routingModule && routingModule.RouteLayer && routingModule.ALL_ROUTES) {
      _routeLayer = new routingModule.RouteLayer({ routes: routingModule.ALL_ROUTES });
    }
  } catch (e) { /* @monobrain/routing not compiled — keyword fallback will be used */ }
  _routeLayerLoading = false;
  return _routeLayer;
}

/**
 * Async variant — tries RouteLayer semantic routing first, falls back to keywords.
 * hook-handler.cjs route handler should call this instead of routeTask().
 */
async function routeTaskSemantic(task) {
  const rl = await tryLoadRouteLayer();
  if (rl && rl.route) {
    try {
      const semantic = await rl.route(task);
      if (semantic && semantic.agentSlug && semantic.confidence > 0.6) {
        return {
          agent: semantic.agentSlug,
          confidence: semantic.confidence,
          reason: 'RouteLayer semantic (' + (semantic.method || 'semantic') + '): ' + semantic.routeName,
          skillMatches: matchSkills(task),
          extrasMatches: [],
          semanticRouting: true,
        };
      }
    } catch (e) { /* fall through to keyword */ }
  }
  return routeTask(task);
}

// ─── Main routing ─────────────────────────────────────────────────────────────
function routeTask(task) {
  const taskLower = task.toLowerCase();

  // Check non-dev first — if clearly non-dev, surface extras instead of dev agents
  if (isNonDevTask(taskLower)) {
    const extrasMatches = matchExtras(task);
    return {
      agent: 'extras',
      confidence: 0.85,
      reason: 'Non-development domain detected — extras agents available',
      skillMatches: [],
      extrasMatches,
    };
  }

  // Dev task pattern matching
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      return {
        agent,
        confidence: 0.8,
        reason: `Matched pattern: ${pattern}`,
        skillMatches: matchSkills(task),
        extrasMatches: [],
      };
    }
  }

  // Default — low confidence, show both skill and extras suggestions
  return {
    agent: 'coder',
    confidence: 0.5,
    reason: 'Default routing - no specific pattern matched',
    skillMatches: matchSkills(task),
    extrasMatches: matchExtras(task),
  };
}

/**
 * Load the full text of an extras agent by slug.
 * Used when Claude picks an agent to activate.
 */
function loadExtrasAgent(slug) {
  const registry = loadExtrasRegistry();
  const entry = registry.extras.find(e => e.slug === slug || e.name.toLowerCase() === slug.toLowerCase());
  if (!entry) return null;
  try {
    return { ...entry, content: fs.readFileSync(entry.filePath, 'utf8') };
  } catch (e) { return null; }
}

module.exports = { routeTask, routeTaskSemantic, matchSkills, matchExtras, loadExtrasAgent, loadExtrasRegistry, loadSkillRegistry, AGENT_CAPABILITIES, TASK_PATTERNS };

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
