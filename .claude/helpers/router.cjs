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

function matchExtras(task, topN = 8) {
  if (typeof task !== 'string') return [];
  const registry = loadExtrasRegistry();
  const taskLower = task.toLowerCase();
  return registry.extras
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
 * Async variant — tries RouteLayer semantic routing first, falls back to keywords.
 * hook-handler.cjs route handler should call this instead of routeTask().
 */
async function routeTaskSemantic(task) {
  if (typeof task !== 'string' || !task) return routeTask(task);
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
  return routeTask(task);
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

  // Dev task pattern matching
  for (const [pattern, agent] of Object.entries(TASK_PATTERNS)) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(taskLower)) {
      return {
        agent,
        agentSlug: agent,
        confidence: 0.8,
        reason: `Matched pattern: ${pattern}`,
        skillMatches: matchSkills(task),
        extrasMatches: [],
        specificAgents: SPECIFIC_AGENTS_MAP[agent] || [],
      };
    }
  }

  // Default — low confidence, show both skill and extras suggestions
  return {
    agent: 'coder',
    agentSlug: 'coder',
    confidence: 0.5,
    reason: 'Default routing - no specific pattern matched',
    skillMatches: matchSkills(task),
    extrasMatches: matchExtras(task),
    specificAgents: SPECIFIC_AGENTS_MAP['coder'] || [],
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
