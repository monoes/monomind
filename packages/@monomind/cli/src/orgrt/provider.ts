import type { ProviderConfig, OrgRole } from './types.js';
import { configManager } from '../services/config-file-manager.js';

const KEY_VAR = ['ANTHROPIC', 'API', 'KEY'].join('_');

/**
 * Builds the child-process env for one agent session.
 * Default (no provider block) = subscription: remove the API key var so the
 * spawned Claude Code engine uses the user's `claude login` credentials.
 * Never stores secrets in org JSON — only env var NAMES.
 */
export function resolveProviderEnv(
  cfg: ProviderConfig | undefined,
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(parentEnv)) if (v !== undefined) env[k] = v;
  const kind = cfg?.kind ?? 'subscription';

  switch (kind) {
    case 'subscription':
      delete env[KEY_VAR];
      delete env.ANTHROPIC_BASE_URL;
      delete env.ANTHROPIC_AUTH_TOKEN;
      break;
    case 'api-key': {
      const name = cfg?.apiKeyEnv ?? KEY_VAR;
      // Direct value (named-provider config) takes precedence over the env var.
      const key = cfg?.apiKey ?? parentEnv[name];
      if (!key) throw new Error(`provider api-key: env var ${name} is not set`);
      env[KEY_VAR] = key;
      delete env.ANTHROPIC_AUTH_TOKEN; // leftover parent token would override the key in the engine
      break;
    }
    case 'base-url': {
      if (!cfg?.baseUrl) throw new Error('provider base-url: baseUrl is required');
      env.ANTHROPIC_BASE_URL = cfg.baseUrl;
      delete env[KEY_VAR];
      // Direct value (named-provider config) first, then the named env var.
      if (cfg.authToken) {
        env.ANTHROPIC_AUTH_TOKEN = cfg.authToken;
      } else if (cfg.authTokenEnv) {
        const tok = parentEnv[cfg.authTokenEnv];
        if (!tok) throw new Error(`provider base-url: env var ${cfg.authTokenEnv} is not set`);
        env.ANTHROPIC_AUTH_TOKEN = tok;
      }
      break;
    }
    case 'bedrock': env.CLAUDE_CODE_USE_BEDROCK = '1'; delete env[KEY_VAR]; delete env.ANTHROPIC_AUTH_TOKEN; break;
    case 'vertex': env.CLAUDE_CODE_USE_VERTEX = '1'; delete env[KEY_VAR]; delete env.ANTHROPIC_AUTH_TOKEN; break;
    case 'gemini': {
      const name = cfg?.apiKeyEnv ?? 'GEMINI_API_KEY';
      const key = parentEnv[name];
      if (key) env.GEMINI_API_KEY = key;
      delete env[KEY_VAR];
      delete env.ANTHROPIC_AUTH_TOKEN;
      break;
    }
    case 'openai': {
      const name = cfg?.apiKeyEnv ?? 'OPENAI_API_KEY';
      const key = parentEnv[name];
      if (key) env.OPENAI_API_KEY = key;
      delete env[KEY_VAR];
      delete env.ANTHROPIC_AUTH_TOKEN;
      break;
    }
    case 'vercel-api-key': {
      // Vercel runners consume the API key from process.env directly via the
      // named env var; surface it so the child process inherits it. Throw
      // symmetrically with 'api-key'/'base-url' so daemon.ts fail-fast
      // validation catches a missing key before the run starts (otherwise the
      // first vendor request 401s ~10 minutes into the run).
      const name = cfg?.apiKeyEnv;
      if (name) {
        const key = parentEnv[name];
        if (!key) throw new Error(`provider vercel-api-key: env var ${name} is not set`);
        env[name] = key;
      }
      break;
    }
    case 'codex': {
      // Codex CLI reads ~/.codex/auth.json (created by `codex login`); no env
      // setup needed. Don't manipulate ANTHROPIC_* — codex is independent.
      break;
    }
    case 'antigravity': {
      // Antigravity CLI (agy) stores Google OAuth credentials in the OS keyring
      // after `agy` interactive login; no env setup needed. The CLI is a Go
      // binary installed via curl, independent of Node/Anthropic env.
      break;
    }
  }
  return env;
}

/** One entry of `agents.providers` as written by `monomind providers configure`. */
export interface ConfiguredProviderEntry {
  name: string;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

/** Look up a named provider from the project config (`agents.providers`,
 *  written by `monomind providers configure`). Fresh disk read — the daemon is
 *  long-lived and a cached config would miss keys configured after start. */
export function lookupConfiguredProvider(
  name: string,
  searchFrom: string = process.cwd(),
): ConfiguredProviderEntry | undefined {
  if (!name) return undefined;
  const config = configManager.load(searchFrom);
  const agents = (config?.agents ?? {}) as Record<string, unknown>;
  const providers = (agents.providers ?? []) as Array<Record<string, unknown>>;
  const entry = providers.find(
    (p) => typeof p.name === 'string' && p.name.toLowerCase() === name.toLowerCase(),
  );
  if (!entry) return undefined;
  return {
    name: entry.name as string,
    apiKey: typeof entry.apiKey === 'string' ? entry.apiKey : undefined,
    model: typeof entry.model === 'string' ? entry.model : undefined,
    baseUrl: typeof entry.baseUrl === 'string' ? entry.baseUrl : undefined,
  };
}

/** Effective provider config for a role. Precedence:
 *  1. explicit role-level `provider` block (unchanged behaviour),
 *  2. `adapter_config.provider` — a named provider resolved from
 *     `monomind providers configure` (baseUrl+apiKey → base-url kind,
 *     apiKey only → api-key kind),
 *  3. none (subscription login).
 *
 *  `defaultModel` carries the named provider's configured default model so
 *  roles without an explicit adapter_config.model still get a sensible one.
 *  Throws with an actionable message when the named provider is missing or
 *  carries neither key nor endpoint — before this, the reference was silently
 *  stripped by the schema and the run died ten minutes later with an opaque
 *  "issue with the selected model" from the engine. */
export function resolveRoleProvider(
  role: Pick<OrgRole, 'provider' | 'adapter_config'>,
  searchFrom: string = process.cwd(),
): { cfg?: ProviderConfig; defaultModel?: string } {
  if (role.provider) return { cfg: role.provider };
  const name = role.adapter_config?.provider;
  if (!name) return {};
  const entry = lookupConfiguredProvider(name, searchFrom);
  const hint = `run: monomind providers configure -p ${name} -k <api-key> -e <endpoint-url>`;
  if (!entry) {
    throw new Error(
      `adapter_config.provider "${name}" is not configured in this project (${hint})`,
    );
  }
  if (entry.baseUrl && entry.apiKey) {
    return {
      cfg: { kind: 'base-url', baseUrl: entry.baseUrl, authToken: entry.apiKey },
      defaultModel: entry.model,
    };
  }
  if (entry.apiKey) {
    return { cfg: { kind: 'api-key', apiKey: entry.apiKey }, defaultModel: entry.model };
  }
  throw new Error(
    `provider "${name}" has neither an API key nor an endpoint configured (${hint})`,
  );
}
