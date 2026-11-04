/**
 * Loads `@huggingface/transformers` (and with it onnxruntime, ~400 MB) through
 * the first-use installer in optional-deps.ts instead of by name, so
 * `npm install monomind` no longer pulls it for users who never embed anything.
 *
 *   - `loadTransformers()` imports the pinned copy monomind resolves itself (a
 *     source checkout's devDependency) or the one in `~/.monomind/deps`; when
 *     neither exists it installs the second one with the usual download notice,
 *     unless MONOMIND_NO_AUTO_INSTALL is set (the error then carries the manual
 *     command). `{ install: false }` never downloads: for callers that must
 *     stay offline, a missing runtime simply means "no semantic search".
 *   - A copy loaded from the deps dir keeps its model weights in
 *     `~/.monomind/models` (the deps dir is replaced on a version bump and is
 *     read-only inside org roles), via transformers' `env.cacheDir`. A copy in
 *     a checkout keeps the package's own `.cache`.
 *   - After a failed automatic install the next attempt waits an hour, so an
 *     offline machine does not sit in npm's timeout on every command.
 *
 * Teardown: onnxruntime is loaded by the same entry as before, so the
 * process-exit constraint of ADR-R001 is unchanged.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import {
  autoInstallDisabled,
  depsRoot,
  type EnsureOptions,
  ensureOptionalDependency,
  monomindHome,
  OptionalDependencyError,
  optionalDependencyOwnDir,
  optionalDependencyPresent,
} from './optional-deps.js';

const NAME = '@huggingface/transformers';
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;

export type Transformers = any;

export interface LoadTransformersOptions {
  /** Install the runtime when it is missing (default true). */
  install?: boolean;
  /** Resolution and install hooks; tests replace them. */
  ensure?: EnsureOptions;
}

const loaded: { value?: Promise<Transformers> } = {};

/** Where a runtime installed in the deps dir keeps model weights. */
export function modelCacheDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(monomindHome(env), 'models');
}

/** Whether the runtime can be loaded without a download. */
export function transformersInstalled(ensure: EnsureOptions = {}): boolean {
  return optionalDependencyPresent(NAME, ensure);
}

/** Where the model weights are (or would be) cached; null when no runtime is installed. */
export function transformersCacheDir(): string | null {
  const own = optionalDependencyOwnDir(NAME);
  if (own) return join(own, '.cache');
  return transformersInstalled() ? modelCacheDir() : null;
}

const failureMarker = (env: NodeJS.ProcessEnv): string =>
  join(monomindHome(env), '.transformers-install-failed');

function recentlyFailed(env: NodeJS.ProcessEnv): boolean {
  try {
    return Date.now() - statSync(failureMarker(env)).mtimeMs < RETRY_AFTER_FAILURE_MS;
  } catch {
    return false;
  }
}

function markFailed(env: NodeJS.ProcessEnv): void {
  try {
    mkdirSync(monomindHome(env), { recursive: true });
    writeFileSync(failureMarker(env), `${new Date().toISOString()}\n`);
  } catch {
    // best effort
  }
}

function pointCacheAtModels(hf: Transformers, env: NodeJS.ProcessEnv): void {
  const hfEnv = hf?.env;
  if (!hfEnv || typeof hfEnv.cacheDir !== 'string') return;
  const rel = relative(depsRoot(env), hfEnv.cacheDir);
  if (rel && rel !== '..' && !rel.startsWith(`..${sep}`)) hfEnv.cacheDir = modelCacheDir(env);
}

async function load(install: boolean, ensure: EnsureOptions): Promise<Transformers> {
  const env = ensure.env ?? process.env;
  if (!install && !transformersInstalled(ensure)) {
    throw new OptionalDependencyError(
      `${NAME} is not installed; run \`monomind download-embeddings\` to install it.`,
    );
  }
  if (install && !transformersInstalled(ensure) && recentlyFailed(env)) {
    throw new OptionalDependencyError(
      `${NAME} could not be installed a moment ago; not retrying for an hour. ` +
        'Run `monomind download-embeddings` to try again.',
    );
  }
  try {
    const mod = await ensureOptionalDependency<Transformers>(NAME, ensure);
    // A CommonJS entry imported by path exposes the API on the namespace or on `default`.
    const hf = typeof mod?.pipeline === 'function' ? mod : (mod?.default ?? mod);
    pointCacheAtModels(hf, env);
    return hf;
  } catch (err) {
    if (install && !autoInstallDisabled(env) && !transformersInstalled(ensure)) markFailed(env);
    throw err;
  }
}

/** The loaded `@huggingface/transformers` module; rejects when unavailable. */
export function loadTransformers(opts: LoadTransformersOptions = {}): Promise<Transformers> {
  const install = opts.install !== false;
  const p = (loaded.value ??= load(install, opts.ensure ?? {}));
  p.catch(() => {
    if (loaded.value === p) loaded.value = undefined;
  });
  return p;
}

/** Forgets the memoized module (tests). */
export function resetTransformersLoader(): void {
  loaded.value = undefined;
}
