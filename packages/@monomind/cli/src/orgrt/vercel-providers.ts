// packages/@monomind/cli/src/orgrt/vercel-providers.ts
/**
 * Registry of Vercel AI SDK providers. Each entry maps a vendor slug to the
 * dynamic import spec, factory function, default model, and env var name.
 *
 * VercelAgentRunner uses this to resolve and construct the right provider
 * instance at runtime. All packages are optionalDependencies — missing
 * packages produce a clear actionable error instead of a crash.
 */

export interface VercelProviderDef {
  vendor: string;
  /** npm import specifier for dynamic import(). */
  package: string;
  /** Factory function exported by the package (e.g. createOpenAI). */
  factory: string;
  /** Sane default model when role doesn't pin one. */
  defaultModel: string;
  /** Default API key env var name. */
  envVar: string;
  /** Override base URL (e.g. GLM's z.ai endpoint). */
  defaultBaseUrl?: string;
  /** If true, use @ai-sdk/openai with custom baseURL (Chat Completions API). */
  isOpenAiCompatible?: boolean;
}

export const VERCEL_PROVIDERS: Record<string, VercelProviderDef> = {
  openai: {
    vendor: 'openai',
    package: '@ai-sdk/openai',
    factory: 'createOpenAI',
    defaultModel: 'gpt-5.5',
    envVar: 'OPENAI_API_KEY',
  },
  anthropic: {
    vendor: 'anthropic',
    package: '@ai-sdk/anthropic',
    factory: 'createAnthropic',
    defaultModel: 'claude-sonnet-5',
    envVar: 'ANTHROPIC_API_KEY',
  },
  glm: {
    vendor: 'glm',
    package: '@ai-sdk/anthropic',
    factory: 'createAnthropic',
    defaultModel: 'glm-5.2',
    envVar: 'ZHIPU_API_KEY',
    // z.ai's Anthropic-compatible endpoint — billed against the GLM coding-plan
    // resource package, unlike the paas/v4 Chat Completions endpoint which
    // draws from a separate pay-per-token balance.
    // createAnthropic() does not auto-append /v1 the way the official default
    // baseURL does — it must be included explicitly or z.ai 404s with a 200
    // status + JSON error body (looks like a stream, isn't one).
    defaultBaseUrl: 'https://api.z.ai/api/anthropic/v1',
  },
  google: {
    vendor: 'google',
    package: '@ai-sdk/google',
    factory: 'createGoogleGenerativeAI',
    defaultModel: 'gemini-3.1-pro',
    envVar: 'GOOGLE_GENERATIVE_AI_API_KEY',
  },
  xai: {
    vendor: 'xai',
    package: '@ai-sdk/xai',
    factory: 'createXAI',
    defaultModel: 'grok-4.5',
    envVar: 'XAI_API_KEY',
  },
  deepseek: {
    vendor: 'deepseek',
    package: '@ai-sdk/deepseek',
    factory: 'createDeepSeek',
    defaultModel: 'deepseek-chat',
    envVar: 'DEEPSEEK_API_KEY',
  },
  mistral: {
    vendor: 'mistral',
    package: '@ai-sdk/mistral',
    factory: 'createMistral',
    defaultModel: 'mistral-large-latest',
    envVar: 'MISTRAL_API_KEY',
  },
  groq: {
    vendor: 'groq',
    package: '@ai-sdk/groq',
    factory: 'createGroq',
    defaultModel: 'moonshotai/kimi-k2-instruct-0905',
    envVar: 'GROQ_API_KEY',
  },
  together: {
    vendor: 'together',
    package: '@ai-sdk/togetherai',
    factory: 'createTogetherAI',
    defaultModel: 'zai-org/GLM-5',
    envVar: 'TOGETHER_API_KEY',
  },
  fireworks: {
    vendor: 'fireworks',
    package: '@ai-sdk/fireworks',
    factory: 'createFireworks',
    defaultModel: 'accounts/fireworks/models/glm-5p2',
    envVar: 'FIREWORKS_API_KEY',
  },
  cohere: {
    vendor: 'cohere',
    package: '@ai-sdk/cohere',
    factory: 'createCohere',
    defaultModel: 'command-a-reasoning-08-2025',
    envVar: 'COHERE_API_KEY',
  },
  perplexity: {
    vendor: 'perplexity',
    package: '@ai-sdk/perplexity',
    factory: 'createPerplexity',
    defaultModel: 'sonar-reasoning-pro',
    envVar: 'PERPLEXITY_API_KEY',
  },
  alibaba: {
    vendor: 'alibaba',
    package: '@ai-sdk/alibaba',
    factory: 'createAlibaba',
    defaultModel: 'qwen3-max',
    envVar: 'ALIBABA_API_KEY',
  },
  openrouter: {
    vendor: 'openrouter',
    package: '@openrouter/ai-sdk-provider',
    factory: 'createOpenRouter',
    defaultModel: 'anthropic/claude-sonnet-5',
    envVar: 'OPENROUTER_API_KEY',
  },
  ollama: {
    vendor: 'ollama',
    // ollama-ai-provider (v1, abandoned) pinned @ai-sdk/provider-utils@^2.0.0,
    // which is entirely within the vulnerable range of GHSA-866g-f22w-33x8
    // (uncontrolled resource consumption in createJsonResponseHandler) with
    // no fix possible short of a major bump. ollama-ai-provider-v2 is the
    // actively maintained fork targeting @ai-sdk/provider-utils@^5.0.5 — the
    // same provider-utils major version every other provider here already
    // uses (@ai-sdk/openai et al. all sit on @ai-sdk/provider@4.x), so this
    // also removes a duplicate old dependency subtree rather than adding one.
    // Same exported factory name (createOllama) and callable-provider shape
    // (provider(modelId) => LanguageModelV4) — drop-in, no call-site changes.
    package: 'ollama-ai-provider-v2',
    factory: 'createOllama',
    defaultModel: 'llama3.3',
    envVar: '',
    defaultBaseUrl: 'http://localhost:11434/v1',
  },
  'openai-compatible': {
    vendor: 'openai-compatible',
    package: '@ai-sdk/openai',
    factory: 'createOpenAI',
    defaultModel: '',
    envVar: '',
    isOpenAiCompatible: true,
  },
};

/** Resolve a provider instance via dynamic import. Throws clear error if
 *  the package is missing (optionalDependencies pattern — mirrors how
 *  opencode-runner and kimicode-runner handle missing SDK packages). */
export async function loadVercelProvider(
  def: VercelProviderDef,
  apiKey?: string,
  baseUrl?: string,
): Promise<(modelId: string) => any> {
  // Hold the specifier in a variable so TypeScript types the result as `any`
  // and does NOT try to resolve (and fail on) the missing module at compile
  // time — same pattern as opencode-runner.ts for @opencode-ai/sdk.
  const pkgSpec = def.package;
  let mod: any;
  try {
    mod = await import(/* @vite-ignore */ pkgSpec);
  } catch {
    throw new Error(
      `VercelAgentRunner: vendor "${def.vendor}" requires the "${def.package}" package. ` +
        `Install it: npm install ${def.package}`,
    );
  }
  const factory = mod[def.factory];
  if (!factory) throw new Error(`VercelAgentRunner: ${def.package} does not export ${def.factory}`);

  const opts: Record<string, any> = {};
  if (apiKey) opts.apiKey = apiKey;
  const effectiveBaseUrl = baseUrl ?? def.defaultBaseUrl;
  if (effectiveBaseUrl) opts.baseURL = effectiveBaseUrl;
  const provider = factory(opts);

  // For OpenAI-compatible providers serving custom endpoints (GLM, Ollama,
  // arbitrary OpenAI-compatible APIs), use .chat() factory — these endpoints
  // typically only implement Chat Completions, not the Responses API.
  if (def.isOpenAiCompatible && typeof provider.chat === 'function') {
    return (modelId: string) => provider.chat(modelId);
  }
  return (modelId: string) => provider(modelId);
}
