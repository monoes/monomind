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
      delete env.ANTHROPIC_AUTH_TOKEN;
      break;
    case 'api-key': {
      const name = cfg?.apiKeyEnv ?? KEY_VAR;
      const key = parentEnv[name];
      if (!key) throw new Error(`provider api-key: env var ${name} is not set`);
      env[KEY_VAR] = key;
      delete env.ANTHROPIC_AUTH_TOKEN; // leftover parent token would override the key in the engine
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
