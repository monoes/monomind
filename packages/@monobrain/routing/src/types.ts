export interface Route {
  /** Unique name for this route, typically an agent category */
  name: string;
  /** The agent slug from ALLOWED_AGENT_TYPES to dispatch to */
  agentSlug: string;
  /** 10–15 representative task descriptions for this agent */
  utterances: string[];
  /** Minimum cosine similarity required for a confident match (default: 0.72) */
  threshold: number;
  /** If true and confidence < threshold, escalate to LLM classifier */
  fallbackToLLM: boolean;
  /** Human-readable description of what this agent handles */
  description?: string;
}

export interface RouteResult {
  /** The resolved agent slug from ALLOWED_AGENT_TYPES */
  agentSlug: string;
  /** Cosine similarity score (0.0–1.0) */
  confidence: number;
  /** How the routing decision was made */
  method: 'semantic' | 'keyword' | 'llm_fallback';
  /** The route name that matched */
  routeName: string;
  /** All routes with their scores, for debugging */
  allScores?: Array<{ routeName: string; agentSlug: string; score: number }>;
}

export interface LLMFallbackConfig {
  /** Injected LLM caller for testability */
  llmCaller: (prompt: string) => Promise<string>;
  /** Model to use — should be Haiku for cost efficiency */
  model?: 'haiku' | 'sonnet';
  /** Maximum tokens to request from LLM */
  maxTokens?: number;
  /** Log fallback events to this function (defaults to console.warn) */
  onFallback?: (routeName: string, taskDescription: string, confidence: number) => void;
}

export interface RouteLayerConfig {
  routes: Route[];
  /** Encoder type to use for embeddings */
  encoder?: 'hnsw' | 'local';
  /** If true, include all route scores in RouteResult */
  debug?: boolean;
  /** Global minimum threshold override */
  globalThreshold?: number;
  /** LLM fallback configuration for low-confidence matches */
  llmFallback?: LLMFallbackConfig;
  /** Enable keyword pre-filter before semantic routing (default: true) */
  enableKeywordFilter?: boolean;
  /** Custom keyword rules prepended before DEFAULT_KEYWORD_ROUTES */
  keywordRules?: Array<{ pattern: RegExp; agentSlug: string; routeName: string; description: string }>;
}

export interface AgentCapability {
  slug: string;
  description: string;
  taskTypes: string[];
  expertise: string[];
}
