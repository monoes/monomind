#!/usr/bin/env node

/**
 * Alias kept for the old command name: `pnpm run sync:claude-trees[:check]`.
 * The derived `.claude` trees are generated, not hand-synced, by
 * scripts/generate-claude-trees.mjs (see its header). `compileGeneratedSkills`
 * is re-exported for the scripts and tests that import it from here.
 */

import { pathToFileURL } from 'node:url';

import { main } from './generate-claude-trees.mjs';

export { compileGeneratedSkills } from './generate-claude-trees.mjs';

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await main(process.argv.slice(2)));
}
