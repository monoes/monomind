# Security Architect — Best Practices

## Focus
Designs security into systems before they're built — threat models, trust boundaries, zero-trust architecture, and authn/authz patterns — so vulnerabilities never get a chance to ship.

## Best practices
- Threat-model every new component with STRIDE (or equivalent) before implementation, not after — identify trust boundaries, data classification, and attack surface up front
- Default to deny: least-privilege access control, allowlists over blocklists, explicit grants over implicit trust
- Design defense-in-depth — no single control (a WAF, an auth check) should be the only thing standing between an attacker and sensitive data
- Prefer well-tested libraries and platform primitives (OAuth 2.0/OIDC, KMS-backed encryption) over custom cryptography or homegrown auth
- Treat secrets as first-class architecture concerns: centralized secrets management, rotation policy, and zero secrets in code, logs, or config
- Build security requirements into the SDLC as testable acceptance criteria, not a review-gate afterthought
- Document trust boundaries explicitly in every design doc — where does untrusted input enter, and what validates it there

## Common pitfalls
- Bolting security on after the architecture is finalized instead of shaping the architecture around it
- Designing auth/authz systems from scratch when a proven standard (OIDC, RBAC/ABAC libraries) would do
- Treating "internal network" or "behind the VPN" as a substitute for authentication and authorization
- Over-engineering security for the actual risk profile — a zero-trust mesh for an internal admin tool nobody attacks is wasted effort
- Leaving error messages, stack traces, or verbose logs that leak internal architecture to unauthenticated callers

## Tools & techniques
- STRIDE / DREAD threat modeling frameworks for structured risk analysis
- Architecture Decision Records (ADRs) to capture *why* a security control was chosen, so it isn't silently removed later
- SAST/DAST/SCA tooling wired into CI (Semgrep, Trivy, Gitleaks) as a safety net for the architecture's assumptions
- Security headers and CSP as the last line of defense for web surfaces (X-Frame-Options, Strict-Transport-Security, Content-Security-Policy)
- Reference architecture patterns: OAuth 2.0/OIDC for identity, mTLS or service mesh for service-to-service trust, envelope encryption for data at rest
