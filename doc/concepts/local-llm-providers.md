# Local LLM Providers (Ollama, llama.cpp)

> monomind supports local LLMs via the OpenAI-compatible endpoint. This means you can run monomind orgs, memory operations, and agent sessions entirely offline — no cloud API key required.

## Ollama Setup

### 1. Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh
```

### 2. Pull a model

```bash
ollama pull llama3.1    # or qwen2.5, mistral, etc.
ollama serve            # starts the OpenAI-compatible API on port 11434
```

### 3. Configure monomind to use it

For **org runtime roles** — set the provider to use Ollama's OpenAI-compatible endpoint:

```json
{
  "id": "researcher",
  "title": "Researcher",
  "type": "specialist",
  "reports_to": "boss",
  "adapter_config": {
    "model": "llama3.1"
  },
  "provider": {
    "kind": "vercel-api-key",
    "vendor": "ollama",
    "baseUrl": "http://localhost:11434/v1"
  },
  "runtime": "vercel"
}
```

For **memory/embeddings** — monomind already uses local transformers.js embeddings by default. No Ollama dependency needed for embeddings.

### 4. Verify

```bash
# Test the Ollama endpoint
curl http://localhost:11434/v1/models

# Run an org with local models
monomind org run my-team --dry-run    # preview
monomind org run my-team              # execute (all local, no cloud tokens)
```

## Supported Providers

| Provider | Env var | Endpoint | Notes |
|---|---|---|---|
| **Ollama** | none | `http://localhost:11434/v1` | OpenAI-compatible; no API key needed |
| **llama.cpp** | none | `http://localhost:8080/v1` | OpenAI-compatible server mode |
| **LM Studio** | none | `http://localhost:1234/v1` | OpenAI-compatible; no API key needed |

All three use `vendor: "ollama"` or `vendor: "openai-compatible"` in the Vercel AI SDK runner.

## Limitations

- Local models may have smaller context windows than Claude/GPT — adjust `max_turns_per_message` in your org config accordingly.
- Tool calling quality varies by model. Llama 3.1+ and Qwen 2.5+ have the best tool-calling support among open models.
- No usage API for cost tracking — the `org run` cost estimate will show $0 for local models (which is correct — they're free to run).

## See also

- `doc/concepts/org-runtime.md` — org runtime configuration
- `docs/positioning.md` — why local-first is monomind's core differentiator
