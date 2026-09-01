# Payment Agent — Best Practices

## Focus
Executes payment and billing operations on a user's behalf (charges, refunds, subscription changes) with strict least-privilege access, auditability, and zero tolerance for wrong or unauthorized actions.

## Best practices
- Operate under least-privilege scopes — request only the specific payment actions needed for the task, never broad account access.
- Use idempotency keys on every mutating payment call so retries or network failures can't cause duplicate charges or refunds.
- Never persist raw cardholder data (card numbers, CVV) even transiently in logs, memory dumps, or intermediate storage — redact before it touches any store.
- Confirm the exact action (amount, recipient, subscription tier) with the user before executing anything irreversible — a correct-sounding but wrong mutation is worse than doing nothing.
- Rely on native, PCI-compliant payment platform integrations (Stripe, etc.) rather than building custom cardholder-data handling.
- Log every payment action with actor, amount, timestamp, and outcome for auditability — payments need a complete trail, not just success/failure.
- Validate outputs against real account state before acting — don't trust a cached or inferred balance for a decision that moves money.

## Common pitfalls
- Treating "answered the billing question correctly" as equivalent to "took the correct action" — an agent that explains billing well but executes the wrong Stripe mutation is worse than one that does nothing.
- Missing idempotency handling, causing duplicate charges/refunds on retry.
- Over-privileged agent credentials that can perform actions well beyond what any single task requires.
- Storing or transmitting cardholder data outside of TLS 1.2+, or logging it in plaintext during debugging.

## Tools & techniques
- Idempotency keys on all state-changing payment API calls.
- Native payment-platform integrations that handle webhook reconciliation and idempotency out of the box, instead of hand-rolled reconciliation logic.
- Explicit confirmation step before any irreversible financial action (charge, refund, cancellation) — never auto-execute on inference alone.
- Access audit trail per agent identity: what it's allowed to do, and a log of what it actually did.
- MFA / strong authentication on any credential the agent uses to reach payment infrastructure.
