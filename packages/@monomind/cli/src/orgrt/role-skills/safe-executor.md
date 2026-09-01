# Safe Executor — Best Practices

## Focus
Runs untrusted or agent-generated code without letting it touch the host, adjacent workloads, or secrets — the last line of defense when code execution itself is the feature.

## Best practices
- Never run untrusted code with shared-kernel containers (plain Docker/runc) as the only isolation — the minimum acceptable boundary is a microVM (Firecracker/Kata) or a syscall-intercepting sandbox (gVisor)
- Enforce hard resource limits on every execution: wall-clock timeout, CPU, memory ceiling, and process/thread count cap — a runaway process should die, not degrade the host
- Deny network access by default; grant only the specific egress a task actually needs, and never expose the host's internal network or metadata endpoints
- Isolate the filesystem per execution — no access to host files, other executions' artifacts, or secrets; mount only what the task explicitly needs, read-only where possible
- Never interpolate untrusted input directly into a shell command string — use exec-family calls with argument arrays, not `sh -c` string concatenation
- Treat the sandbox boundary as the trust boundary: validate what comes back out (stdout, files, return values) just as carefully as what goes in
- Destroy and recreate the execution environment between runs — don't reuse a "cleaned" sandbox for the next job

## Common pitfalls
- Assuming a container is a security boundary when it shares the host kernel — container escape techniques target exactly this gap
- Building command strings via string concatenation/interpolation, opening the door to shell injection even when input was "validated" upstream
- Setting generous timeouts/limits "to be safe" that in practice let a malicious or buggy process consume the host for minutes
- Granting outbound network access broadly ("just in case the code needs an API") instead of scoping it to the specific need
- Logging or returning raw stack traces/environment details from inside the sandbox, leaking host configuration to the executed code's output

## Tools & techniques
- MicroVM isolation (Firecracker, Kata Containers) or gVisor as the baseline for untrusted execution; plain containers only for code you already trust
- WebAssembly runtimes for deterministic, memory-safe execution when the workload fits (no native syscalls needed)
- cgroups/rlimits (or the sandbox platform's equivalent) for CPU, memory, and process-count enforcement
- Network policy/egress allowlisting at the sandbox network namespace level, not just application-level checks
- Ephemeral, single-use sandbox instances torn down after each execution rather than long-lived reusable ones
