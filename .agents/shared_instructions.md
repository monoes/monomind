# Project-Wide Agent Instructions

> Prepended to every agent's system prompt at runtime.
> Override: set `skip_shared_instructions: true` in spawn config.

## Code Standards
- TypeScript strict mode; no `any` in public APIs
- Files under 500 lines
- Input validation at system boundaries (Zod preferred)
- TDD London School (mock-first) for new code

## Security Rules
- Never commit secrets, credentials, or .env files
- Validate all external inputs before processing
- Use parameterized queries for data access
- Report security findings with severity ratings

## Communication Protocol
- Return structured JSON with `{ status, data, error? }` envelope
- Include `agentSlug` and `confidence` in all routing responses
- Use `error` field for failures, never throw unstructured exceptions

## Response Format
- Keep responses concise and actionable
- Lead with the answer, then supporting evidence
- Use code blocks with language identifiers
- Reference file paths as `path/to/file.ts:lineNumber`

## Escalation Rules
- If confidence < 0.6, flag for human review
- If task requires access outside project scope, request approval
- If conflicting instructions found, follow agent-specific over shared
