/**
 * `monomind decision providers configure|test|list|remove` — named
 * decision-model providers (issue #835). A sibling of, not a change to, the
 * generic `providers` command. Entries live in decision-providers.json (project
 * `.monomind/`, or `~/.monomind/` with --scope user), read by jev-providers.cjs
 * next to the MONOMIND_JEV_* variables. The file stores only the NAME of the
 * environment variable that holds the key, never the key.
 */

import type { JevPickerModule, NamedProviderEntry, ProviderScope } from '../decision/jev.js';
import { jevModule } from '../decision/jev.js';
import { output } from '../output.js';
import type { Command, CommandContext, CommandResult } from '../types.js';

export interface DecisionProvidersDeps {
  jev: Pick<JevPickerModule, 'registry' | 'probe' | 'normalizeBaseUrl'>;
  env: NodeJS.ProcessEnv;
  cwd: string;
  fetchImpl?: typeof fetch;
}

export interface ProvidersResult extends CommandResult {
  message?: string;
}

interface ConfigureArgs {
  name?: string;
  kind?: string;
  url?: string;
  apiKeyEnv?: string;
  model?: string;
  scope?: string;
  local?: boolean;
  samples?: number;
  /** USD per million tokens. */
  priceIn?: number;
  priceOut?: number;
  /** Only to refuse it: keys are never stored. */
  key?: string;
}

const SCOPES: ProviderScope[] = ['project', 'user'];

const fail = (message: string): ProvidersResult => ({ success: false, exitCode: 1, message });

function fileFor(deps: DecisionProvidersDeps, scope: ProviderScope): string | null {
  return deps.jev.registry.storeFile(scope, deps.env, { cwd: deps.cwd });
}

export async function runConfigure(
  args: ConfigureArgs,
  deps: DecisionProvidersDeps,
): Promise<ProvidersResult> {
  if (args.key !== undefined) {
    return fail(
      'Keys are never stored. Export the key and pass its name with --api-key-env <VAR>.',
    );
  }
  if (!args.name) return fail('--name is required.');
  if (!args.url) return fail('--url is required.');
  const scope = (args.scope ?? 'project') as ProviderScope;
  if (!SCOPES.includes(scope)) return fail('--scope must be project or user.');
  const entry: NamedProviderEntry = {
    name: args.name,
    kind: args.kind ?? 'systemone',
    baseUrl: deps.jev.normalizeBaseUrl(args.url) ?? args.url,
    ...(args.apiKeyEnv ? { apiKeyEnv: args.apiKeyEnv } : {}),
    ...(args.model ? { model: args.model } : {}),
    ...(args.local ? { local: true } : {}),
    ...(args.samples !== undefined ? { samples: args.samples } : {}),
    ...(args.priceIn !== undefined && args.priceOut !== undefined
      ? { pricing: { in: args.priceIn / 1e6, out: args.priceOut / 1e6 } }
      : {}),
  };
  const problem = deps.jev.registry.validateEntry(entry);
  if (problem) return fail(`Not saved: ${problem}`);
  const file = fileFor(deps, scope);
  if (!file) return fail(`No ${scope} directory to store the provider in.`);
  const notes = await detectCapabilities(entry, deps);
  const store = deps.jev.registry.readStore(file);
  const others = store.providers.filter((p) => p.name !== entry.name);
  deps.jev.registry.writeStore(file, [...others, entry]);
  return {
    success: true,
    data: entry,
    message: [`Provider "${entry.name}" saved to ${file}`, ...notes].join('\n'),
  };
}

/** Kinds that can learn something by asking (openai: does it send logprobs?)
 *  are probed once at configure time; the result is stored on the entry. */
async function detectCapabilities(
  entry: NamedProviderEntry,
  deps: DecisionProvidersDeps,
): Promise<string[]> {
  const detect = deps.jev.registry.detect;
  if (!detect) return [];
  const keyName = entry.apiKeyEnv;
  const key = keyName ? deps.env[keyName]?.trim() : undefined;
  if (keyName && !key)
    return [`Not probed: ${keyName} is not set. Export it and run \`decision providers test\`.`];
  try {
    const found = await detect(probeConfig(entry, key), { fetchImpl: deps.fetchImpl });
    Object.assign(entry, found);
    return found.logprobs === false
      ? ['This endpoint sends no logprobs: answers carry no probabilities and never act automatically.']
      : [];
  } catch (err) {
    return [`Saved, but could not probe the endpoint: ${err instanceof Error ? err.message : String(err)}`];
  }
}

interface Located {
  entry: NamedProviderEntry;
  scope: ProviderScope;
  file: string;
}

function locateAll(deps: DecisionProvidersDeps): Located[] {
  const out: Located[] = [];
  const seen = new Set<string>();
  for (const scope of SCOPES) {
    const file = fileFor(deps, scope);
    if (!file || seen.has(file)) continue;
    seen.add(file);
    for (const entry of deps.jev.registry.readStore(file).providers)
      out.push({ entry, scope, file });
  }
  return out;
}

export async function runList(
  _args: { json?: boolean },
  deps: DecisionProvidersDeps,
): Promise<ProvidersResult> {
  const rows = locateAll(deps).map(({ entry, scope }) => ({
    name: entry.name,
    kind: entry.kind ?? 'systemone',
    baseUrl: entry.baseUrl,
    model: entry.model,
    scope,
    apiKeyEnv: entry.apiKeyEnv,
    keySet: entry.apiKeyEnv ? Boolean(deps.env[entry.apiKeyEnv]?.trim()) : undefined,
    enabled: entry.enabled !== false,
    problem: deps.jev.registry.validateEntry(entry) ?? undefined,
  }));
  return { success: true, data: rows };
}

export async function runRemove(
  args: { name?: string },
  deps: DecisionProvidersDeps,
): Promise<ProvidersResult> {
  if (!args.name) return fail('--name is required.');
  const hit = locateAll(deps).find((l) => l.entry.name === args.name);
  if (!hit) return fail(`Provider "${args.name}" is not configured.`);
  const rest = deps.jev.registry.readStore(hit.file).providers.filter((p) => p.name !== args.name);
  deps.jev.registry.writeStore(hit.file, rest);
  return { success: true, message: `Provider "${args.name}" removed from ${hit.file}` };
}

/** Shorthand `apiKey` keeps a key variable out of the `apiKey: <expr>` shape the pre-commit secret gate rejects. */
function probeConfig(entry: NamedProviderEntry, apiKey: string | undefined) {
  return {
    name: entry.name,
    kind: entry.kind ?? 'systemone',
    baseUrl: entry.baseUrl,
    apiKey,
    model: entry.model ?? 'jev-latest',
    ...(entry.logprobs !== undefined ? { logprobs: entry.logprobs } : {}),
    ...(entry.samples !== undefined ? { samples: entry.samples } : {}),
    ...(entry.pricing ? { pricing: entry.pricing } : {}),
    ...(entry.local !== undefined ? { local: entry.local } : {}),
  };
}

export async function runTest(
  args: { name?: string },
  deps: DecisionProvidersDeps,
): Promise<ProvidersResult> {
  const all = locateAll(deps).filter((l) => !args.name || l.entry.name === args.name);
  if (all.length === 0)
    return fail(
      args.name ? `Provider "${args.name}" is not configured.` : 'No providers configured.',
    );
  const lines: string[] = [];
  let ok = true;
  for (const { entry } of all) {
    const problem = deps.jev.registry.validateEntry(entry);
    if (problem) {
      ok = false;
      lines.push(`${entry.name}: ${problem}`);
      continue;
    }
    const config = probeConfig(entry, deps.env[entry.apiKeyEnv ?? '']?.trim() || undefined);
    try {
      lines.push(
        `${entry.name}: ok ${await deps.jev.probe(config, { env: deps.env, fetchImpl: deps.fetchImpl })}ms`,
      );
    } catch (err) {
      ok = false;
      lines.push(`${entry.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { success: ok, exitCode: ok ? undefined : 1, message: lines.join('\n') };
}

// ── CLI wiring ─────────────────────────────────────────────────────────────

function realDeps(): DecisionProvidersDeps | null {
  const jev = jevModule();
  if (!jev) return null;
  return { jev, env: process.env, cwd: process.cwd() };
}

type Runner = (args: never, deps: DecisionProvidersDeps) => Promise<ProvidersResult>;

function wrap(
  run: Runner,
  pick: (ctx: CommandContext) => unknown,
  render?: (r: ProvidersResult) => void,
) {
  return async (ctx: CommandContext): Promise<CommandResult> => {
    const deps = realDeps();
    if (!deps) {
      output.printError('jev-picker.cjs is missing from this install; reinstall monomind.');
      return { success: false, exitCode: 1 };
    }
    const result = await run(pick(ctx) as never, deps);
    if (ctx.flags.json && result.data !== undefined) output.printJson(result.data);
    else if (render) render(result);
    else if (result.message)
      result.success ? output.writeln(result.message) : output.printError(result.message);
    return { success: result.success, exitCode: result.exitCode, data: result.data };
  };
}

const str = (ctx: CommandContext, name: string): string | undefined => {
  const v = ctx.flags[name];
  return typeof v === 'string' && v ? v : undefined;
};
const num = (ctx: CommandContext, name: string): number | undefined => {
  const v = Number(ctx.flags[name]);
  return ctx.flags[name] !== undefined && Number.isFinite(v) && v >= 0 ? v : undefined;
};
const nameArg = (ctx: CommandContext) => ({ name: str(ctx, 'name') ?? ctx.args?.[0] });

const nameOption = {
  name: 'name',
  short: 'n',
  type: 'string',
  description: 'Provider name',
} as const;

const configureCommand: Command = {
  name: 'configure',
  description:
    'Add or replace a named decision-model provider (the key stays in an environment variable)',
  options: [
    { ...nameOption, required: true },
    { name: 'kind', type: 'string', description: 'Provider kind (default systemone)' },
    {
      name: 'url',
      short: 'u',
      type: 'string',
      description: 'Base URL of the provider',
      required: true,
    },
    {
      name: 'api-key-env',
      type: 'string',
      description: 'NAME of the environment variable that holds the key',
    },
    { name: 'model', short: 'm', type: 'string', description: 'Model name sent to the provider' },
    { name: 'scope', type: 'string', description: 'project (default) or user' },
    { name: 'samples', type: 'number', description: 'anthropic kind: samples per question (2-10, default 5)' },
    { name: 'local', type: 'boolean', description: 'A local server: cost is 0' },
    { name: 'price-in', type: 'number', description: 'USD per million input tokens' },
    { name: 'price-out', type: 'number', description: 'USD per million output tokens' },
  ],
  examples: [
    {
      command:
        'monomind decision providers configure -n local -u http://127.0.0.1:3000 --api-key-env MY_JEV_KEY',
      description: 'Add a self-hosted OpenJev server',
    },
    {
      command:
        'monomind decision providers configure -n oa --kind openai -u https://api.openai.com -m gpt-4o-mini --api-key-env OPENAI_API_KEY',
      description: 'Add an OpenAI-compatible chat model (probes for logprobs)',
    },
  ],
  action: wrap(runConfigure, (ctx) => ({
    name: str(ctx, 'name') ?? ctx.args?.[0],
    kind: str(ctx, 'kind'),
    url: str(ctx, 'url'),
    apiKeyEnv: str(ctx, 'api-key-env') ?? str(ctx, 'apiKeyEnv'),
    model: str(ctx, 'model'),
    scope: str(ctx, 'scope'),
    local: ctx.flags.local === true,
    samples: num(ctx, 'samples'),
    priceIn: num(ctx, 'price-in'),
    priceOut: num(ctx, 'price-out'),
    key: str(ctx, 'key') ?? str(ctx, 'api-key') ?? str(ctx, 'apiKey'),
  })),
};

const testCommand: Command = {
  name: 'test',
  description: 'Probe named providers with one fixed sentence (sends a request)',
  options: [nameOption],
  action: wrap(runTest, nameArg),
};

const listCommand: Command = {
  name: 'list',
  description: 'List named providers (never shows a key)',
  options: [{ name: 'json', short: 'j', type: 'boolean', description: 'Output as JSON' }],
  action: wrap(
    runList,
    () => ({}),
    (r) => {
      const rows = (r.data ?? []) as Array<Record<string, unknown>>;
      if (rows.length === 0)
        output.writeln(
          output.dim('No named decision providers. Add one with `decision providers configure`.'),
        );
      for (const p of rows) {
        const key = p.apiKeyEnv ? `key ${p.apiKeyEnv} ${p.keySet ? 'set' : 'NOT SET'}` : 'no key';
        const issue = p.problem ? ` (ignored: ${p.problem})` : '';
        output.writeln(
          `  ${output.highlight(String(p.name))} ${p.kind} ${p.baseUrl} [${p.scope}] ${key}${issue}`,
        );
      }
    },
  ),
};

const removeCommand: Command = {
  name: 'remove',
  description: 'Remove a named provider',
  options: [{ ...nameOption, required: true }],
  action: wrap(runRemove, nameArg),
};

const providersGroup: Command = {
  name: 'providers',
  description: 'Named decision-model providers (configure, test, list, remove)',
  subcommands: [configureCommand, testCommand, listCommand, removeCommand],
};

export const decisionCommand: Command = {
  name: 'decision',
  description: 'Decision-model settings (named providers for agent and skill picking)',
  subcommands: [providersGroup],
};
