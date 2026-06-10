'use strict';
/**
 * Keyword-based task router for hook-handler.cjs
 * Returns: { agent, agentSlug, confidence, reason, semanticRouting, specificAgents, skillMatches, extrasMatches }
 */

const KEYWORD_ROUTES = [
  { pattern: /\b(bug|fix|error|exception|crash|broken|fail|regression|null pointer|undefined)\b/i, agent: 'coder', confidence: 0.85 },
  { pattern: /\b(test|spec|coverage|vitest|jest|mocha|unit test|integration test|e2e)\b/i, agent: 'tester', confidence: 0.85 },
  { pattern: /\b(review|audit|code quality|lint|smell|refactor|clean up|cleanup)\b/i, agent: 'reviewer', confidence: 0.82 },
  { pattern: /\b(architect|design|system design|ADR|domain|bounded context|microservice|pattern)\b/i, agent: 'system-architect', confidence: 0.85 },
  { pattern: /\b(security|vulnerability|CVE|injection|XSS|CSRF|auth|permissions|OWASP)\b/i, agent: 'Security Engineer', confidence: 0.90 },
  { pattern: /\b(performance|optimiz|slow|bottleneck|profil|benchmark|latency|throughput)\b/i, agent: 'coder', confidence: 0.80 },
  { pattern: /\b(deploy|CI\/CD|pipeline|docker|kubernetes|infra|devops|helm|terraform)\b/i, agent: 'DevOps Automator', confidence: 0.85 },
  { pattern: /\b(document|readme|docs|api reference|jsdoc|write up)\b/i, agent: 'Technical Writer', confidence: 0.82 },
  { pattern: /\b(feature|implement|add|build|create|develop|new)\b/i, agent: 'coder', confidence: 0.75 },
  { pattern: /\b(research|investigate|explore|analyze|survey|compare)\b/i, agent: 'researcher', confidence: 0.78 },
  { pattern: /\b(plan|roadmap|strategy|prioritize|breakdown|estimate)\b/i, agent: 'planner', confidence: 0.80 },
  { pattern: /\b(memory|vector|embedding|HNSW|sqlite|database|query)\b/i, agent: 'coder', confidence: 0.82 },
  { pattern: /\b(hook|swarm|agent|mcp|cli|routing|monomind)\b/i, agent: 'coder', confidence: 0.80 },
  { pattern: /\b(mobile|ios|android|react native|flutter)\b/i, agent: 'mobile-dev', confidence: 0.88 },
  { pattern: /\b(ml|machine learning|AI|model|training|inference|neural)\b/i, agent: 'AI Engineer', confidence: 0.85 },
  { pattern: /\b(api|rest|graphql|endpoint|http|websocket|grpc)\b/i, agent: 'backend-dev', confidence: 0.80 },
  { pattern: /\b(ui|frontend|react|vue|component|css|layout|design)\b/i, agent: 'Frontend Developer', confidence: 0.80 },
];

const DEFAULT_RESULT = {
  agent: 'coder',
  agentSlug: 'coder',
  confidence: 0.60,
  reason: 'Default routing — no strong keyword match',
  semanticRouting: false,
  specificAgents: [],
  skillMatches: [],
  extrasMatches: [],
};

function routeTask(prompt) {
  if (!prompt || typeof prompt !== 'string') return DEFAULT_RESULT;

  var best = null;
  for (var i = 0; i < KEYWORD_ROUTES.length; i++) {
    var rule = KEYWORD_ROUTES[i];
    if (rule.pattern.test(prompt)) {
      if (!best || rule.confidence > best.confidence) {
        best = rule;
      }
    }
  }

  if (!best) return DEFAULT_RESULT;

  return {
    agent: best.agent,
    agentSlug: best.agent.toLowerCase().replace(/\s+/g, '-'),
    confidence: best.confidence,
    reason: 'Keyword match: ' + best.pattern.toString().slice(1, 40),
    semanticRouting: false,
    specificAgents: [],
    skillMatches: [],
    extrasMatches: [],
  };
}

module.exports = {
  routeTask: routeTask,
  routeTaskSemantic: routeTask,
};
