import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['__tests__/**/*.test.ts', 'src/__tests__/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '**/._*'],
    setupFiles: ['__tests__/setup/resource-governor.setup.ts'],
    globals: true,
    // Cap worker count: this box-class (10 cores / 16 GB) cannot sustain the
    // default ~10 workers when several test files each load a 100MB+ ONNX
    // embedding model and native SQLite per worker — the kernel swaps, every
    // test slows 5-10x, and even 60-90s timeouts trip variably. 4 workers
    // keeps peak memory sane; the suite wall-time is unchanged in practice
    // because the thrash was already serializing everything.
    maxWorkers: 4,
    // 30s default: this suite intentionally runs real-fs / real-subprocess
    // tests (init, doctor, memory backends with first-use embedding-model
    // loads). At 15s those tests were green in isolation but timed out
    // variably under full-suite parallel load — pure contention flakiness.
    // Tests that need longer still carry their own explicit timeout.
    testTimeout: 30000,
    server: {
      // @monoes/monobrowse resolves through the pnpm workspace symlink into
      // node_modules, so Vitest externalizes it by default and vi.mock('ws')
      // never intercepts its `import { WebSocket } from 'ws'` — CdpClient
      // ends up making a real network connection in tests. Inline it so the
      // module graph goes through Vite's transform/mock pipeline instead.
      deps: { inline: [/@monoes\/monobrowse/] },
    },
    // Coverage is off by default so the normal edit/test loop stays fast, but
    // it is fully working — run `npm run test:coverage` (or pass --coverage).
    //
    // This block previously read "Disable coverage for CLI package (uses
    // vitest v2)". That rationale was stale: the package is on vitest 4.x, and
    // coverage was verified working here. Because nobody re-tested the claim,
    // there was no measurement of what the ~1,200 tests actually exercise —
    // which meant untested modules had to be found by import analysis instead.
    // Baseline at the time of enabling, with the filters below applied:
    // 34.5% statements, 27.4% branches, 38.6% functions.
    coverage: {
      enabled: false,
      provider: 'v8',
      reporter: ['text-summary', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      // Measure shipped source only — not tests, build output, or generated
      // asset data, which would otherwise dilute the numbers.
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/__tests__/**',
        'src/**/*.d.ts',
        'src/ui/data/**',
      ],
    },
  },
});
