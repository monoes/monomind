---
name: monograph-code-navigation
description: "Use when coding, refactoring, debugging or reviewing in a monomind project and you need symbols, callers or blast radius from the Monograph code graph. Explains which monograph tool answers which question and when to fall back to grep."
tags: ["engineering","testing","monomind","refactor","code-review"]
tools: ["monograph_query","monograph_context","monograph_impact","monograph_neighbors","monograph_suggest"]
license: Apache-2.0
source: https://github.com/monoes/monomind
---
# Monograph code navigation

The project is indexed into a code knowledge graph. Your monograph tools arrive
prefixed with the provider name (for example `monomind__monograph_query`).
Use the graph before grep: it answers "where is X" and "what depends on X"
with file paths and line numbers in one call.

## Which tool when

| Question | Tool |
|---|---|
| Where is the thing named like X? | `monograph_query` (query, optional label: Function/Class/Method) |
| What calls X, what does X call, who imports it? | `monograph_context` (name, optional filePath) |
| If I change X, what breaks? | `monograph_impact` (name, depth 3 default) |
| What is directly wired to X? | `monograph_neighbors` (name or nodeId) |
| Where do I start on this task? | `monograph_suggest` (task = the task text) |

## Workflow

1. **Orient.** Starting a task that touches several files: `monograph_suggest`
   with the task text, then `monograph_query` for the named symbols.
2. **Before editing a function:** `monograph_context` to see every caller.
   A bug fix belongs where all callers route through, not in the one path the
   ticket mentions.
3. **Before changing a signature or behaviour:** `monograph_impact`. A high
   risk score or callers in other packages means update or test those too.
4. **Before handing off or reviewing:** for each function the diff changes,
   `monograph_impact` it and check its callers are still correct and covered
   by tests.
5. **Fallback.** If a tool returns zero results or says the index is missing,
   use grep/Read — the graph can lag very recent edits. Mention it in your
   report rather than silently trusting an empty answer.

## Reporting

When you hand work back, name the symbols changed and the callers you checked
(from `monograph_impact`), so the reviewer can verify the blast radius instead
of rediscovering it.
