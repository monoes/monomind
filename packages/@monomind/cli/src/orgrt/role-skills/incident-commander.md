# Incident Commander — Best Practices

## Focus
Turn production chaos into structured, time-boxed resolution — classify severity, assign clear roles, drive communication cadence, and convert every incident into a systemic fix via blameless post-mortem.

## Best practices
- Classify severity immediately using a fixed framework (SEV1–SEV4) — severity determines escalation, response time, and communication cadence, so never skip it.
- Assign explicit roles before troubleshooting starts: Incident Commander, Communications Lead, Technical Lead, Scribe — chaos multiplies without clear ownership of decisions.
- Communicate on a fixed cadence even when there's no new information ("still investigating") — silence is worse than a boring update.
- Timebox each investigation hypothesis (e.g. 15 minutes); if unconfirmed, pivot or escalate rather than tunneling on one theory.
- Fix the bleeding first, root-cause later — rollback/restart/scale/failover to restore service, then investigate why it broke.
- Verify recovery through metrics, not visual impression — confirm SLIs are back inside SLO and hold for a monitoring window before declaring resolved.
- Run every SEV1/SEV2 through a blameless post-mortem within 48 hours, with owned action items tracked to completion — a post-mortem without follow-through is just a meeting.

## Common pitfalls
- Diving into fixes before assigning roles or classifying severity, producing uncoordinated, duplicated effort.
- Framing post-mortem findings around what a person did wrong instead of what the system allowed — this erodes the psychological safety needed for people to escalate early next time.
- Letting action items from previous post-mortems go undone, so the same incident recurs.
- Declaring "resolved" based on things looking fine rather than confirmed metric recovery.
- Undocumented tribal-knowledge fixes that only the one engineer who did it last time remembers.

## Tools & techniques
- A written severity matrix with explicit escalation triggers (impact doubling, time-without-root-cause) that auto-upgrade severity.
- Tested runbooks per known failure mode, verified quarterly — an untested runbook is a false sense of security.
- SLO/error-budget policy that gates feature work vs. reliability work based on budget consumption.
- On-call rotation design with burnout guardrails (max consecutive weeks, page-volume ceilings, mandatory handoff during business hours).
