/**
 * Coverage Router MCP Tools
 *
 * MCP tool implementations for coverage-aware routing.
 * Integrates with hooks_coverage_route and hooks_coverage_suggest from ruvector.
 */
import { coverageRoute, coverageSuggest, coverageGaps, } from './coverage-router.js';
/**
 * Coverage-aware routing MCP tool
 *
 * Routes tasks to optimal agents based on test coverage gaps.
 * Uses ruvector's hooks_coverage_route when available.
 */
export const hooksCoverageRoute = {
    name: 'hooks/coverage-route',
    description: 'Route task to agents based on test coverage gaps (ruvector integration)',
    category: 'coverage',
    tags: ['coverage', 'routing', 'testing', 'ruvector'],
    inputSchema: {
        type: 'object',
        properties: {
            task: {
                type: 'string',
                description: 'Task description to route',
            },
            projectRoot: {
                type: 'string',
                description: 'Project root directory (defaults to cwd)',
            },
            threshold: {
                type: 'number',
                description: 'Coverage threshold percentage (default: 80)',
            },
            useRuvector: {
                type: 'boolean',
                description: 'Use ruvector integration if available (default: true)',
            },
        },
        required: ['task'],
    },
    handler: async (params) => {
        const task = params.task;
        const projectRoot = params.projectRoot;
        const threshold = params.threshold;
        const useRuvector = params.useRuvector;
        return coverageRoute(task, {
            projectRoot,
            threshold,
            useRuvector,
        });
    },
};
/**
 * Coverage suggestions MCP tool
 *
 * Suggests which files need better coverage in a given path.
 * Uses ruvector's hooks_coverage_suggest when available.
 */
export const hooksCoverageSuggest = {
    name: 'hooks/coverage-suggest',
    description: 'Suggest coverage improvements for a path (ruvector integration)',
    category: 'coverage',
    tags: ['coverage', 'suggestions', 'testing', 'ruvector'],
    inputSchema: {
        type: 'object',
        properties: {
            path: {
                type: 'string',
                description: 'Path to analyze for coverage suggestions',
            },
            projectRoot: {
                type: 'string',
                description: 'Project root directory (defaults to cwd)',
            },
            threshold: {
                type: 'number',
                description: 'Coverage threshold percentage (default: 80)',
            },
            limit: {
                type: 'number',
                description: 'Maximum number of suggestions to return (default: 20)',
            },
            useRuvector: {
                type: 'boolean',
                description: 'Use ruvector integration if available (default: true)',
            },
        },
        required: ['path'],
    },
    handler: async (params) => {
        const path = params.path;
        const projectRoot = params.projectRoot;
        const threshold = params.threshold;
        const limit = params.limit;
        const useRuvector = params.useRuvector;
        return coverageSuggest(path, {
            projectRoot,
            threshold,
            limit,
            useRuvector,
        });
    },
};
/**
 * Coverage gaps MCP tool
 *
 * Lists all coverage gaps in the project with agent assignments.
 */
export const hooksCoverageGaps = {
    name: 'hooks/coverage-gaps',
    description: 'List all coverage gaps with priority scoring and agent assignments',
    category: 'coverage',
    tags: ['coverage', 'gaps', 'testing', 'analysis'],
    inputSchema: {
        type: 'object',
        properties: {
            projectRoot: {
                type: 'string',
                description: 'Project root directory (defaults to cwd)',
            },
            threshold: {
                type: 'number',
                description: 'Coverage threshold percentage (default: 80)',
            },
            groupByAgent: {
                type: 'boolean',
                description: 'Group gaps by suggested agent (default: true)',
            },
            useRuvector: {
                type: 'boolean',
                description: 'Use ruvector integration if available (default: true)',
            },
        },
    },
    handler: async (params) => {
        const projectRoot = params.projectRoot;
        const threshold = params.threshold;
        const groupByAgent = params.groupByAgent;
        const useRuvector = params.useRuvector;
        return coverageGaps({
            projectRoot,
            threshold,
            groupByAgent,
            useRuvector,
        });
    },
};
/**
 * All coverage router MCP tools
 */
export const coverageRouterTools = [
    hooksCoverageRoute,
    hooksCoverageSuggest,
    hooksCoverageGaps,
];
export default coverageRouterTools;
//# sourceMappingURL=coverage-tools.js.map