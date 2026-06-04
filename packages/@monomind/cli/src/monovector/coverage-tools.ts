/**
 * Coverage Router MCP Tools (ADR-017)
 *
 * Exposes coverage-aware routing over MCP: analyze test-coverage data, list gaps
 * with agent assignments, and suggest concrete test improvements. Thin wrappers
 * around `./coverage-router.js` (the shared pure logic also used by the
 * `monomind route coverage` CLI command).
 *
 * @module @monomind/cli/monovector/coverage-tools
 */

import type { MCPTool, MCPToolResult } from '../mcp-tools/types.js';
import { coverageRoute, coverageGaps, coverageSuggest } from './coverage-router.js';

function text(value: unknown): MCPToolResult {
  return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }] };
}

function errorResult(message: string): MCPToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export const coverageRouterTools: MCPTool[] = [
  {
    name: 'coverage_route',
    description:
      'Produce a coverage-aware routing decision from test-coverage data on disk ' +
      '(Jest/Istanbul coverage-summary.json, lcov.info, or nyc out.json). Returns an ' +
      'action (add-tests/prioritize/review-coverage/skip), priority, impact score, ' +
      'estimated effort, suggested test types, and the target files below threshold.',
    category: 'coverage',
    tags: ['coverage', 'routing', 'testing'],
    cacheable: true,
    cacheTTL: 30_000,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Optional path prefix to scope the analysis (e.g. "src/auth").' },
        threshold: { type: 'number', description: 'Coverage threshold percentage (default 80).' },
      },
    },
    handler: async (input) => {
      try {
        const result = await coverageRoute(
          (input.path as string) || '',
          { threshold: (input.threshold as number) ?? 80 }
        );
        if (!result.found) {
          return text('No coverage report found. Run your test suite with coverage enabled (e.g. `vitest run --coverage`), then retry.');
        }
        return text(result);
      } catch (err) {
        return errorResult(`coverage_route failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'coverage_gaps',
    description:
      'List files whose line coverage is below the threshold, each assigned to an ' +
      'appropriate agent (tester, backend-dev, security-architect, frontend-developer, coder), ' +
      'grouped by agent. Useful for fanning out coverage work across a swarm.',
    category: 'coverage',
    tags: ['coverage', 'gaps', 'testing'],
    cacheable: true,
    cacheTTL: 30_000,
    inputSchema: {
      type: 'object',
      properties: {
        threshold: { type: 'number', description: 'Coverage threshold percentage (default 80).' },
        path: { type: 'string', description: 'Optional path prefix to scope the gaps.' },
      },
    },
    handler: async (input) => {
      try {
        const result = await coverageGaps({
          threshold: (input.threshold as number) ?? 80,
          path: (input.path as string) || undefined,
          groupByAgent: true,
        });
        if (!result.found) return text(result.summary);
        return text(result);
      } catch (err) {
        return errorResult(`coverage_gaps failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
  {
    name: 'coverage_suggest',
    description:
      'Suggest concrete test improvements for files below the coverage threshold under a ' +
      'given path — prioritized, with estimated effort and per-file suggested tests.',
    category: 'coverage',
    tags: ['coverage', 'suggestions', 'testing'],
    cacheable: true,
    cacheTTL: 30_000,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path prefix to suggest improvements for (default ".").' },
        threshold: { type: 'number', description: 'Coverage threshold percentage (default 80).' },
        limit: { type: 'number', description: 'Max suggestions to return (default 20).' },
      },
    },
    handler: async (input) => {
      try {
        const result = await coverageSuggest(
          (input.path as string) || '.',
          { threshold: (input.threshold as number) ?? 80, limit: (input.limit as number) ?? 20 }
        );
        if (!result.found) {
          return text('No coverage report found. Run your test suite with coverage enabled, then retry.');
        }
        return text(result);
      } catch (err) {
        return errorResult(`coverage_suggest failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  },
];

export default coverageRouterTools;
