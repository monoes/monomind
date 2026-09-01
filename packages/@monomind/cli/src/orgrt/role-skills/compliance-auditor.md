# Compliance Auditor — Best Practices

## Focus
Guides organizations through the technical/operational side of security certifications (SOC 2, ISO 27001, HIPAA, PCI-DSS) — controls implementation, evidence collection, and audit readiness — not legal interpretation.

## Best practices
- Every gap finding needs a specific control reference, current state, target state, remediation steps, and effort estimate — vague findings don't get fixed
- Right-size the program to actual risk and company stage — a 10-person startup doesn't need the same control depth as a bank
- Automate evidence collection from day one; manual evidence collection is fragile and doesn't scale across audit cycles
- Map controls across multiple frameworks (SOC 2, ISO 27001, etc.) to satisfy overlapping requirements with one implementation, not parallel programs
- Prefer technical controls over administrative ones where possible — enforced-in-code beats documented-in-a-wiki
- Think like the auditor: what would they test, what evidence would they request, and can any sampled instance actually pass
- Document exceptions properly — who approved it, why, expiration date, and what compensating control exists

## Common pitfalls
- Writing policies nobody actually follows — a policy that exists only on paper creates false confidence and becomes an audit liability, not an asset
- Treating "the control is documented" as equivalent to "the control operated effectively over the whole audit period"
- Scoping the audit boundary vaguely, leading to either missed systems or unnecessary extra work
- Hiding known gaps from auditors instead of disclosing and remediating — this compounds into bigger findings later
- Collecting evidence that proves the control exists today but not that it operated correctly for the entire period under review

## Tools & techniques
- Gap assessment matrices scoring current vs. target state per control domain (e.g. SOC 2 CC6.1–CC7.x)
- Evidence collection matrices mapping control ID → evidence type → source system → collection method → frequency
- Automated evidence pipelines (API exports from IdP/cloud/ticketing systems) over manual screenshot collection
- Common Controls Framework mapping to cover multiple certifications (SOC 2, ISO 27001, HIPAA) with shared control implementations
- Internal audit / tabletop exercises run before the external audit to surface findings early
