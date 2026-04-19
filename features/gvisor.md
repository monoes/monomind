# gVisor (google/gvisor)

> **Note:** References to `@monobrain/security` in this document are historical. That package was removed in the 2026-04-19 cleanup. Security features are now in `@monobrain/aidefence`.

**Source:** https://gvisor.dev | https://dl.acm.org/doi/10.1145/3317550.3321422  
**Category:** Container Security / OS Sandboxing  
**Role in Monobrain:** Reducing Docker syscall surface for agent sandboxing

---

## What It Is

gVisor is Google's OCI-compatible container runtime that interposes on system calls between containerized applications and the host kernel. Instead of letting containers make direct syscalls to the host, gVisor's `runsc` runtime intercepts them in userspace, reducing the attack surface from 350+ possible Linux syscalls to approximately 50 interceptions.

The gVisor paper (USENIX ATC 2019) formalized the threat model for multi-tenant container environments and demonstrated that the performance cost of syscall interposition is acceptable (5-15% overhead) for server workloads in exchange for a dramatically smaller kernel attack surface.

## What We Extracted

### Reduced Syscall Surface for Agent Sandboxing
When Monobrain runs agents in Docker containers (production deployments, isolated task execution), the default Docker runtime gives containers access to the full Linux syscall interface. A malicious or buggy agent could exploit obscure syscalls to escape the container or affect the host.

gVisor's `runsc` runtime is wired into Monobrain's `SandboxConfig` as an optional hardening layer:

```
SandboxConfig.use_gvisor = true
```

When enabled, `buildDockerArgs()` adds `--runtime=runsc` to the Docker run command, intercepting all agent syscalls through gVisor's userspace kernel. This is particularly important for:
- Agents that execute arbitrary code (bash commands, test runners)
- Agents with access to the filesystem
- Multi-tenant deployments where agents from different users share a host

The tradeoff is ~10% throughput reduction in exchange for preventing kernel-level container escape.

## How It Improved Monobrain

gVisor addressed a hard security requirement: agents that can run bash commands are essentially untrusted code execution environments. Without syscall interposition, a compromised or adversarially-prompted agent could theoretically escalate privileges via kernel vulnerabilities. gVisor's threat model — treat the container runtime as a second security boundary — is the correct production security posture for autonomous agent systems.

## Key Files Influenced

- `packages/@monobrain/security/src/sandbox-config.ts` — `use_gvisor` flag
- `packages/@monobrain/cli/src/deployment/` — `buildDockerArgs()` runtime selection
- Security documentation and deployment guides
