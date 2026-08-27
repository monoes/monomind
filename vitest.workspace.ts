import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const WORKSPACE_ROOT = fileURLToPath(new URL('.', import.meta.url));

/**
 * Workspace config — drives `pnpm test:all`
 * (`vitest --config vitest.workspace.ts`).
 *
 * Vitest 4.x dropped `defineWorkspace` and the array-export form: a workspace
 * is now a regular config object whose `test.projects` array lists per-package
 * configs (string paths) and/or inline project entries. We use objects with
 * `extends` so we can attach a unique `sequence.groupOrder` per project —
 * vitest 4 requires unique groupOrder when projects have different
 * `maxWorkers` (the CLI package sets `maxWorkers: 4`).
 *
 * The root suite stays on `vitest.config.ts` (auto-discovered by `vitest`
 * when no `--config` is passed), so `pnpm test` keeps its current scope
 * (tests/**) — see TOOL-4 / TEST-1 in
 * docs/mastermind/plans/2026-08-11-swarm-audit-fixes.md.
 *
 * Note: TEST-6 asks for a JUnit reporter IF `vitest-junit-reporter` is
 * available. It is NOT a dependency of this repo (verified at write time),
 * so we skip silently — the `reporters` block below is ready to uncomment
 * once the dep lands.
 */
export default defineConfig({
  test: {
    // reporters: ['default', ['junit', { outputFile: './test-results/junit.xml' }]],
    projects: [
      // Root monorepo-wide suite (tests/**).
      {
        extends: './vitest.config.ts',
        root: WORKSPACE_ROOT,
        test: { name: 'root', sequence: { groupOrder: 0 } },
      },
      // Per-package suites — vitest reads each package's own vitest.config.ts.
      // Each gets a unique groupOrder so vitest 4 doesn't refuse to mix
      // projects with different maxWorkers.
      {
        extends: './packages/@monomind/cli/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/cli'),
        test: { name: 'cli', sequence: { groupOrder: 1 } },
      },
      {
        extends: './packages/@monomind/hooks/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/hooks'),
        test: { name: 'hooks', sequence: { groupOrder: 2 } },
      },
      {
        extends: './packages/@monomind/mcp/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/mcp'),
        test: { name: 'mcp', sequence: { groupOrder: 3 } },
      },
      {
        extends: './packages/@monomind/memory/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/memory'),
        test: { name: 'memory', sequence: { groupOrder: 4 } },
      },
      {
        extends: './packages/@monomind/monograph/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/monograph'),
        test: { name: 'monograph', sequence: { groupOrder: 5 } },
      },
      {
        extends: './packages/@monomind/routing/vitest.config.ts',
        root: resolve(WORKSPACE_ROOT, 'packages/@monomind/routing'),
        test: { name: 'routing', sequence: { groupOrder: 6 } },
      },
    ],
  },
});
