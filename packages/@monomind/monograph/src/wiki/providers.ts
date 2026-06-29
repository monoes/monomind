export type LLMProvider = 'anthropic' | 'openai' | 'ollama';

export interface LLMConfig {
  provider: LLMProvider;
  model?: string;       // e.g. "claude-3-haiku-20240307", "gpt-4o-mini", "mistral"
  apiKey?: string;      // read from env if not provided
  baseUrl?: string;     // for ollama: "http://localhost:11434"
  maxTokens?: number;   // default 2048
  temperature?: number; // default 0.2
}

export interface LLMResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

const REASONING_MODELS = new Set(['o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini']);

function isReasoningModel(model: string): boolean {
  return REASONING_MODELS.has(model) || /^o\d+(-mini|-preview)?$/.test(model);
}

/**
 * Call an LLM provider with the given prompt and configuration.
 * Supports anthropic, openai, and ollama providers.
 */
export async function callLLM(prompt: string, config: LLMConfig): Promise<LLMResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    switch (config.provider) {
      case 'anthropic':
        return await callAnthropic(prompt, config, controller.signal);
      case 'openai':
        return await callOpenAI(prompt, config, controller.signal);
      case 'ollama':
        return await callOllama(prompt, config, controller.signal);
      default: {
        const _exhaustive: never = config.provider;
        throw new Error(`Unknown LLM provider: ${_exhaustive}`);
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }
}

async function callAnthropic(
  prompt: string,
  _config: LLMConfig,
  _signal: AbortSignal,
): Promise<LLMResponse> {
  // Route through Claude Code CLI — reuses host auth, no API key needed.
  const { claudeCliCall } = await import('../claude-cli.js');
  const text = await claudeCliCall(prompt);
  return { text };
}

async function callOpenAI(
  prompt: string,
  config: LLMConfig,
  signal: AbortSignal,
): Promise<LLMResponse> {
  const apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'];
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    signal,
    headers: {
      'Authorization': `Bearer ${apiKey ?? ''}`,
      'content-type': 'application/json',
    },
    body: (() => {
      const reasoning = isReasoningModel(config.model ?? '');
      const bodyObj: Record<string, unknown> = {
        model: config.model ?? 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
      };
      if (reasoning) {
        bodyObj['max_completion_tokens'] = config.maxTokens ?? 2048;
      } else {
        bodyObj['max_tokens'] = config.maxTokens ?? 2048;
        bodyObj['temperature'] = config.temperature ?? 0.2;
      }
      return JSON.stringify(bodyObj);
    })(),
  });

  if (!response.ok) {
    throw new Error(`LLM provider openai error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
    usage: { prompt_tokens: number; completion_tokens: number };
  };

  return {
    text: data.choices[0].message.content,
    inputTokens: data.usage.prompt_tokens,
    outputTokens: data.usage.completion_tokens,
  };
}

async function callOllama(
  prompt: string,
  config: LLMConfig,
  signal: AbortSignal,
): Promise<LLMResponse> {
  const baseUrl = config.baseUrl ?? 'http://localhost:11434';
  const response = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: config.model ?? 'mistral',
      prompt,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`LLM provider ollama error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json() as { response: string };

  return {
    text: data.response,
  };
}
