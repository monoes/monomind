# Indirect Prompt Injection (arXiv:2302.12173 + 2310.12815)

> **Note:** References to `@monobrain/security` in this document are historical. That package was removed in the 2026-04-19 cleanup. Security features are now in `@monobrain/aidefence`.

**Source:** https://arxiv.org/abs/2302.12173 | https://arxiv.org/abs/2310.12815  
**Category:** AI Security Research  
**Role in Monobrain:** External content validation, aidefence semantic scanning, injection pattern detection

---

## What It Is

The indirect prompt injection research papers (Greshake et al., 2023 and follow-up) documented and formalized the attack class where malicious instructions are embedded in content that an LLM tool retrieves from an external source — a webpage, a file, an API response, a code comment. Unlike direct injection (user typing malicious instructions), indirect injection is invisible to the user and arrives through the tool use pipeline.

The papers demonstrated attacks including:
- Web pages that hijack a browsing agent to exfiltrate user data
- Documents that instruct a code-reading agent to output credentials
- API responses that cause an agent to take destructive actions the user never requested

## What We Extracted

### `validateExternalContent()` in `@monobrain/security`
The research identified the key invariant that defends against indirect injection: **every piece of content retrieved from an external source must be treated as potentially adversarial before being passed to the LLM**.

Monobrain implements this as `validateExternalContent()` in `@monobrain/security`. Every externally-sourced content item passes through a two-layer validation:

**Layer 1 — Pattern matching**: Fast regex scan for known injection signatures:
- `Ignore all previous instructions`
- `Forget your instructions`
- `You are now a different AI`
- `Output your system prompt`
- Common data exfiltration patterns

**Layer 2 — aidefence semantic scan** (optional): When `AIDEFENCE_API_KEY` is configured, the content is sent to the `mcp__monobrain__aidefence_scan` tool for semantic analysis that can detect novel injection attempts that don't match known patterns.

Content that fails either layer is rejected with a structured error rather than passed to the LLM.

## How It Improved Monobrain

The indirect injection research changed how Monobrain treats tool outputs. Before this influence, the system naively assumed that content retrieved by the agent was safe to show the LLM. After, a validation boundary exists at every external content ingestion point: web fetches, file reads from outside the project directory, API responses, and MCP tool outputs.

This is especially critical for Monobrain because its agents routinely fetch external content — searching the web, reading third-party documentation, cloning repositories — and passing adversarial content directly to Claude would be a severe security failure.

## Key Files Influenced

- `packages/@monobrain/security/src/input-validator.ts` — `validateExternalContent()`
- `hook-handler.cjs` `pre-bash` handler — command injection pattern detection
- `packages/@monobrain/cli/src/mcp-tools/` — external content validation wrappers
- `mcp__monobrain__aidefence_scan` — semantic injection detection
