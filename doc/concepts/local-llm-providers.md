# Local LLM Providers (Ollama, llama.cpp)

> monomind supports local LLMs through the Vercel AI SDK runner, via Ollama's native API or an OpenAI-compatible endpoint. This means you can run monomind orgs, memory operations, and agent sessions entirely offline — no cloud API key required.

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

For **org runtime roles** — set the provider to use Ollama. `vendor: "ollama"` speaks Ollama's native API, so `baseUrl` ends in `/api`; leave it out and the runner uses `http://localhost:11434/v1`, where Ollama serves no native chat route:

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
    "baseUrl": "http://localhost:11434/api"
  },
  "runtime": "vercel"
}
```

For **memory/embeddings** — monomind runs embeddings locally with transformers.js (`@huggingface/transformers`, about 500 MB, installed on demand); without it, memory falls back to a hash-based embedding. No Ollama dependency needed for embeddings.

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
| **Ollama** | none | `http://localhost:11434/api` (`vendor: "ollama"`) or `http://localhost:11434/v1` (`vendor: "openai-compatible"`) | No API key needed with `vendor: "ollama"` |
| **llama.cpp** | see note | `http://localhost:8080/v1` | OpenAI-compatible server mode |
| **LM Studio** | see note | `http://localhost:1234/v1` | OpenAI-compatible |

llama.cpp, LM Studio and Ollama's `/v1` endpoint use `vendor: "openai-compatible"` in the Vercel AI SDK runner. That vendor still sends an API key: set `apiKeyEnv` to a variable holding any non-empty value (or export `OPENAI_API_KEY`), or the request fails with "API key is missing".

## Limitations

- Local models may have smaller context windows than Claude/GPT — adjust `max_turns_per_message` in your org config accordingly.
- Tool calling quality varies by model. Llama 3.1+ and Qwen 2.5+ have the best tool-calling support among open models.
- No USD cost tracking — the Vercel runner reports token usage but no cost, so recorded spend for these roles is unknown rather than $0 (token budgets still apply). The upfront `org run` estimate prices models it does not recognize at a default rate, so it overstates local runs; override with `~/.monomind/rates.json`.

## See also

- `doc/concepts/org-runtime.md` — org runtime configuration
