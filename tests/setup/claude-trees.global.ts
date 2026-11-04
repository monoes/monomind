/**
 * Vitest globalSetup: make sure the generated `.claude` mirror trees exist.
 *
 * packages/@monomind/cli/.claude, .agents/skills, .gemini/{skills,helpers} and
 * the .kimi-code agents/commands/skills are gitignored and written by
 * scripts/generate-claude-trees.mjs (the CLI build runs it too). A fresh
 * checkout that runs the tests without building has none of them, so write
 * them here. Files already holding the right bytes are not rewritten, so
 * concurrent projects and readers are safe. The kimi trees need the built CLI;
 * they are skipped when it is missing (the build generates them).
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function setup(): Promise<void> {
  const mod = await import(
    pathToFileURL(join(REPO_ROOT, 'scripts', 'generate-claude-trees.mjs')).href
  );
  const built = existsSync(
    join(REPO_ROOT, 'packages/@monomind/cli/dist/src/init/write-kimicode.js'),
  );
  await mod.generateTrees({ root: REPO_ROOT, kimi: built });
}
