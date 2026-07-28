# ADR-R001 — Process teardown when onnxruntime is loaded

**Status:** Accepted · **Date:** 2026-07-24 · **Applies to:** any process that can load
`@huggingface/transformers` (and therefore `onnxruntime-node`)

## The rule, in one line

**In the main CLI process, never call `process.exit()` on the success path.**
**In a short-lived worker child, you almost always must.**

The rule inverts depending on which process you are in. Getting it backwards
reintroduces a shipped bug in either direction, so read the whole ADR before
"simplifying" either call site.

## Why

`onnxruntime-node` starts a native thread pool on load. That single fact causes
two *opposite* failure modes:

| Process | If you force-exit | If you let it drain |
|---|---|---|
| Main CLI | **SIGABRT (exit 134)** — see below | Exits cleanly in <1s |
| Worker child | Exits cleanly, result already flushed | **Hangs** until the parent's timeout SIGKILLs it, discarding a correct result |

Forcing exit out from under the live thread pool aborts the process:

```
libc++abi: terminating due to uncaught exception of type
std::__1::system_error: mutex lock failed: Invalid argument
```

The command's own output is already correct and complete when this fires — only
the exit code is wrong (134 instead of 0), which is invisible interactively and
fatal in CI.

## Evidence

Measured directly, loading a real pipeline and varying only the teardown:

| Teardown | Exit code |
|---|---|
| Let the event loop drain | 0 |
| `await pipeline.dispose()`, then drain | 0 |
| `process.exit(0)` | **134** |
| `await pipeline.dispose()`, then `process.exit(0)` | **134** |

Two conclusions worth keeping:

- **Disposing the pipeline first does not help.** The obvious "release the
  resource before exiting" fix does nothing. Only draining works.
- The abort is caused by *forcing the exit*, not by loading onnx. A process that
  merely loads onnx and returns exits 0.

## Decision

### Main CLI process — `packages/@monomind/cli/bin/cli.js`

Publish the exit code and let node exit on its own:

```js
process.exitCode = process.exitCode ?? 0;
setTimeout(() => process.exit(process.exitCode ?? 0), FORCE_EXIT_MS).unref();
```

The timer is **unref'd**, so it does not itself hold the process open — if the
loop is empty node exits immediately (measured: `--version` 0.35s, `memory
search` 0.92s, `doctor` 3.7s). It only fires if something genuinely lingers,
preserving the original "the CLI must never hang forever" guarantee that the
old unconditional `process.exit()` provided.

Guarded by `bin-cli-exit-path.test.ts`.

### Worker children — e.g. `src/routing/embed-worker.ts`

Force-exit after flushing the result, **and** have the parent resolve on a
stdout marker rather than the child's `close` event. Belt and braces: if a
future change breaks the force-exit, the parent degrades to "resolves
immediately, child lingers" instead of "discards a correct result after a 90s
timeout". See `route-layer-factory.ts`.

## Reach

Anything that touches embeddings pulls onnx in transitively — the chain is
`memory-bridge.ts` → `@huggingface/transformers` → `onnxruntime-node`. That
includes `doctor`, `memory store`, `memory search`, and every MCP memory tool,
not just obviously ML-shaped commands. Assume any new exit path is affected.

## History

- The main-process abort shipped in **v2.7.4** and was fixed in **v2.7.5**. It
  was latent long before that: until 2.7.4 the umbrella package never installed
  `@huggingface/transformers`, so the embedder silently no-opped and the exit
  path was never exercised. Fixing the packaging made the native code real and
  the abort appeared on every run.
- The worker-child hang is `P1-3` in `docs/AUDIT-BACKLOG.md` — same root cause,
  opposite fix, which is precisely why this ADR exists.
- Reported once as contention between the CLI and background `monograph watch`
  processes. It is not: it reproduces with zero watch processes running, and the
  immediately preceding version is clean on the same machine.
