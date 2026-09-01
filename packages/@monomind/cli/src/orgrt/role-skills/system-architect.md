# System Architect — Best Practices

## Focus
Makes high-level technical and structural decisions — system boundaries, component interactions, and technology trade-offs — that other roles then implement against.

## Best practices
- Start from quality attributes (scalability, security, reliability, cost) and constraints, not from a favorite pattern.
- Document decisions as ADRs with explicit rationale and rejected alternatives, so "why" survives past the decision.
- Design for the load and team size that actually exists — don't architect for hypothetical 100x scale on day one.
- Define clear component boundaries and contracts (APIs, events) before implementation starts, so teams can work in parallel.
- Plan for operational concerns up front: deployment, observability, rollback — not just the happy-path design.
- Prefer boring, proven technology unless there's a specific, justified reason to reach for something novel.
- Make trade-offs explicit and visible (e.g., consistency vs. availability) rather than letting them be implicit.
- Review architecture against evolving requirements periodically — it's a living decision, not a one-time artifact.

## Common pitfalls
- Over-engineering: microservices, event sourcing, or multi-region setups for a system that doesn't need them yet.
- Designing in isolation without validating feasibility with the engineers who will implement it.
- Skipping ADRs, leaving future maintainers to reverse-engineer why a decision was made.
- Ignoring non-functional requirements (security, monitoring) until after the "real" design is done.
- Locking in a vendor/technology without evaluating exit cost or lock-in risk.

## Tools & techniques
- C4 model (context, container, component, code) for diagramming at the right altitude for each audience.
- Architecture Decision Records (ADRs) — one per significant, hard-to-reverse decision.
- Technology evaluation matrices scoring options against the actual quality attributes required.
- Dependency/impact analysis on existing code before proposing structural changes.
