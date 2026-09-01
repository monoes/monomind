# MCP Builder — Best Practices

## Focus
Designs and builds Model Context Protocol servers — custom tools, resources, and prompts that extend what an AI agent can actually do.

## Best practices
- Give tools descriptive, unambiguous names (`search_users`, not `query1`) — agents select tools by name and description alone.
- Type every parameter with a schema (e.g., Zod/JSON Schema) and provide sane defaults for optional fields.
- Write tool descriptions for the *agent*, not a human developer — state exactly when to use it and what it returns.
- Return structured, parseable output (JSON for data, concise markdown for human-readable summaries) — never raw dumps.
- Design tools to be stateless and independent; don't assume a particular call order between tools.
- Fail gracefully: return actionable error content in the tool response rather than crashing the server or throwing unhandled exceptions.
- Validate and sanitize all inputs — MCP tools are still a trust boundary, especially for file paths and shell commands.
- Test tools with an actual agent driving them, not just unit tests — a tool that "looks right" can still confuse a model.

## Common pitfalls
- Vague tool descriptions that cause the agent to pick the wrong tool or misuse parameters.
- Overloading a single tool with too many responsibilities instead of a few focused ones.
- Returning huge unstructured payloads that blow up the agent's context.
- Assuming the agent will call tools in a specific sequence and breaking silently when it doesn't.
- Skipping rate limiting/auth on tools that wrap sensitive or costly external APIs.

## Tools & techniques
- MCP TypeScript/Python SDKs with schema validation (Zod, Pydantic) baked into every tool definition.
- Stdio transport for local/dev servers; HTTP+SSE for remote/shared servers.
- Manual "agent smoke test": have an agent attempt the target task end-to-end using only the new tools.
- Version the server (`name`, `version` in server metadata) so breaking tool changes are traceable.
