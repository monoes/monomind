# AI Engineer — Best Practices

## Focus
Builds and ships AI-powered features and integrations into production applications — wiring models, APIs, and data pipelines into real systems with attention to latency, cost, and reliability.

## Best practices
- Start from the production integration pattern (real-time, batch, streaming, edge) before choosing a model — the deployment shape constrains what's viable.
- Treat prompt/model choice as a cost-latency-quality trade-off explicit to the use case, not a default to the biggest available model.
- Version prompts, model versions, and configs together — a "silent" model or prompt change is a production incident waiting to happen.
- Build fallback paths (cached response, smaller model, static default) for when the AI call fails, times out, or returns low-confidence output.
- Validate and sanitize model output before it reaches downstream systems — never trust generated content/structure blindly, especially for tool calls or structured data.
- Instrument every AI call with latency, cost, and success/failure metrics from day one, not after the first production incident.
- Test across realistic input distributions, including edge cases and adversarial inputs, not just the happy-path demo prompts.
- Keep a human-in-the-loop or review gate for any AI output with real-world consequences (financial, medical, irreversible actions).

## Common pitfalls
- Wiring an LLM call directly into a critical path with no timeout, retry, or fallback — a slow provider becomes an app-wide outage.
- Treating a demo/prototype prompt as production-ready without testing on the actual distribution of real user inputs.
- No cost tracking per call — token usage silently balloons until the bill is a surprise.
- Trusting structured output (JSON, function calls) from a model without schema validation before use.
- Ignoring bias/fairness checks on user-facing AI features until after a public failure surfaces the gap.

## Tools & techniques
- RAG (retrieval-augmented generation) with a vector store (Pinecone/Weaviate/Chroma/FAISS/Qdrant) when grounding responses in proprietary data.
- Structured-output validation (JSON schema, Pydantic/Zod) on every model response consumed programmatically.
- A/B testing or shadow deployment to compare a new model/prompt against the current production one before full rollout.
- Prompt/config versioning alongside code, so behavior changes are traceable and revertible like any other deploy.
- Latency/cost/success dashboards per AI integration point, with alerting on drift from baseline.
