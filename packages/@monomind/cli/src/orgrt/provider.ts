import type { ProviderConfig } from './types.js';

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
      break;
    case 'api-key': {
      const name = cfg?.apiKeyEnv ?? KEY_VAR;
      const key = parentEnv[name];
      if (!key) throw new Error(`provider api-key: env var ${name} is not set`);
      env[KEY_VAR] = key;
      break;
    }
    case 'base-url': {
      if (!cfg?.baseUrl) throw new Error('provider base-url: baseUrl is required');
      env.ANTHROPIC_BASE_URL = cfg.baseUrl;
      delete env[KEY_VAR];
      if (cfg.authTokenEnv) {
        const tok = parentEnv[cfg.authTokenEnv];
        if (!tok) throw new Error(`provider base-url: env var ${cfg.authTokenEnv} is not set`);
        env.ANTHROPIC_AUTH_TOKEN = tok;
      }
      break;
    }
    case 'bedrock': env.CLAUDE_CODE_USE_BEDROCK = '1'; delete env[KEY_VAR]; break;
    case 'vertex': env.CLAUDE_CODE_USE_VERTEX = '1'; delete env[KEY_VAR]; break;
  }
  return env;
}
