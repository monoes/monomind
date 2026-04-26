# ADR-011: LLM Provider System

## Status
**Implemented** ✅

## Date
2026-01-05

## Last Updated
2026-01-05

## Context

V1 needs a unified LLM provider system that:
1. Supports multiple LLM providers (Anthropic, OpenAI, Google, Cohere, Ollama)
2. Provides cost tracking and optimization
3. Enables intelligent load balancing and failover
4. Integrates with the hooks system for caching and learning

V2 has concrete provider implementations in `v2/src/providers/` that need to be modernized for V1.

## Decision

### 1. Create `@monomind/providers` Package

A dedicated package for LLM provider implementations:

```
packages/@monomind/providers/
├── src/
│   ├── types.ts              # Unified type definitions
│   ├── base-provider.ts      # Abstract base class with circuit breaker
│   ├── anthropic-provider.ts # Claude models
│   ├── openai-provider.ts    # GPT models (+ OpenRouter support)
│   ├── google-provider.ts    # Gemini models
│   ├── cohere-provider.ts    # Command models
│   ├── ollama-provider.ts    # Local models
│   ├── ruvector-provider.ts  # RuVector/ruvLLM with SONA learning
│   ├── provider-manager.ts   # Orchestration layer
│   ├── __tests__/            # Integration tests
│   │   └── quick-test.ts     # Provider test suite
│   └── index.ts              # Public exports
├── package.json
└── tsconfig.json
```

### 2. Provider Interface

All providers implement a unified interface:

```typescript
interface ILLMProvider {
  readonly name: LLMProvider;
  readonly capabilities: ProviderCapabilities;

  initialize(): Promise<void>;
  complete(request: LLMRequest): Promise<LLMResponse>;
  streamComplete(request: LLMRequest): AsyncIterable<LLMStreamEvent>;

  healthCheck(): Promise<HealthCheckResult>;
  estimateCost(request: LLMRequest): Promise<CostEstimate>;
  destroy(): void;
}
```

### 3. Provider Manager Features

- **Load Balancing**: Round-robin, latency-based, cost-based strategies
- **Failover**: Automatic fallback to alternative providers
- **Circuit Breaker**: Protection against cascading failures
- **Cost Tracking**: Per-request and aggregate cost monitoring
- **Caching**: LRU cache with TTL for repeated requests

### 4. LLM Hooks Integration

Add LLM-specific hooks to `@monomind/hooks`:

```typescript
// Pre-LLM hooks
- Request caching lookup
- Provider-specific optimizations
- Cost constraint validation

// Post-LLM hooks
- Response caching
- Pattern learning
- Cost tracking
- Performance metrics
```

### 5. Updated Model Support

Include latest models:

**Anthropic (Claude):**
- claude-3-5-sonnet-20241022
- claude-3-opus-20240229
- claude-3-sonnet-20240229
- claude-3-haiku-20240307

**OpenAI:**
- gpt-4o (latest)
- gpt-4o-mini
- gpt-4-turbo
- o1-preview
- o1-mini

**OpenRouter (via OpenAI provider):**
- openai/gpt-4o-mini
- anthropic/claude-3-haiku
- Any OpenRouter-supported model

**Google:**
- gemini-2.0-flash
- gemini-1.5-pro
- gemini-1.5-flash

**Cohere:**
- command-r-plus
- command-r
- command-light

**Ollama (Local):**
- llama3.2
- mistral
- codellama
- phi-4
- qwen2.5 (including 0.5b, 1.5b variants)

**RuVector/ruvLLM (Self-Learning Local):**
- ruvector-auto (auto-selects optimal)
- ruvector-fast (speed-optimized)
- ruvector-quality (quality-optimized)
- ruvector-balanced
- Any Ollama model via fallback

## Consequences

### Positive
- Unified interface simplifies multi-provider usage
- Cost optimization can save 85%+ with intelligent routing
- Circuit breaker prevents cascading failures
- Hook integration enables learning from LLM interactions
- Local model support via Ollama reduces API costs

### Negative
- Additional package to maintain
- Provider API changes require updates
- Testing requires API mocks

### Neutral
- Integration with existing `@monomind/integration` multi-model-router
- Can coexist with agentic-flow's provider system

## Implementation Notes

### Phase 1: Core Implementation ✅ Complete
1. ✅ Create package structure
2. ✅ Implement base provider and types (with circuit breaker, caching)
3. ✅ Implement Anthropic and OpenAI providers

### Phase 2: Extended Providers ✅ Complete
4. ✅ Implement Google, Cohere, Ollama providers
5. ✅ Implement RuVector provider with Ollama fallback
6. ✅ Implement provider manager with load balancing

### Phase 3: Hooks Integration 🔄 Pending
7. Add LLM hooks to @monomind/hooks
8. Integration testing with hooks system

## Validation Results

**Test Date:** 2026-01-05

| Provider | Model | Status | Notes |
|----------|-------|--------|-------|
| Anthropic | claude-3-haiku-20240307 | ✅ Pass | Full API integration |
| Google | gemini-2.0-flash | ✅ Pass | Free tier, streaming support |
| OpenRouter | openai/gpt-4o-mini | ✅ Pass | Via OpenAI-compatible API |
| Ollama | qwen2.5:0.5b | ✅ Pass | Local CPU-friendly model |
| RuVector | qwen2.5:0.5b | ✅ Pass | Ollama fallback working |
| Manager | Multi-provider | ✅ Pass | Load balancing + 0ms cache |

**All 6 providers passing validation.**

### Key Implementation Details

**BaseProvider Features:**
- Circuit breaker pattern (failure threshold: 5, reset: 30s)
- LRU request caching with TTL
- Automatic retry with exponential backoff
- Token estimation for cost calculation
- Event emitter for monitoring

**RuVector Provider:**
- Native ruvLLM server support (port 3000, `/query` endpoint)
- Automatic Ollama fallback when server unavailable
- SONA self-learning integration (when available)
- HNSW vector memory support
- CPU-friendly model support (qwen2.5:0.5b, smollm, tinyllama)

**Provider Manager:**
- Round-robin load balancing
- Automatic failover with configurable attempts
- Response caching (0ms cache hits)
- Provider health monitoring

## References

- V2 Provider System: `v2/src/providers/`
- V1 Multi-Model Router: `packages/@monomind/integration/src/multi-model-router.ts`
- RuVector ruvLLM: `https://github.com/nokhodian/ruvector/tree/main/examples/ruvLLM`
- ADR-001: agentic-flow Integration
- ADR-006: Unified Memory Service
