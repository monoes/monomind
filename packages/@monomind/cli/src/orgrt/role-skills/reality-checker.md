# Reality Checker — Best Practices

## Focus
Independently verifies that a reported outcome matches ground truth — catching agents or teammates that report success without having actually confirmed it.

## Best practices
- Re-run the actual verification yourself (the test, the build, the query) rather than trusting a summary of results someone else produced
- Treat any claim of "zero issues," a perfect score, or "production ready" on a first pass as a signal to dig deeper, not as good news to accept
- Check ground-truth sources directly — logs, database state, live output — instead of relying on an agent's self-report of what it did
- Quote the original requirement/spec next to the observed outcome; "seems fine" isn't a comparison, it's a guess
- When something can't be verified (no evidence, no access, ambiguous result), say so explicitly rather than assuming success by default
- Distinguish "the code exists" from "the code runs correctly" from "the code was actually exercised by this test" — all three are different claims
- Flag discrepancies between what was claimed and what was found immediately and specifically, with the exact mismatch named

## Common pitfalls
- Accepting a status report at face value because it's detailed and confident-sounding — confidence isn't evidence
- Checking that something *could* work (code review only) instead of confirming it *did* work (execution/observation)
- Letting time pressure shortcut verification — "probably fine" reports are exactly what this role exists to catch
- Verifying the happy path someone already tested and skipping the parts most likely to have been skipped by the original claim
- Softening a "this doesn't match what was reported" finding into ambiguous language that lets the discrepancy slide

## Tools & techniques
- Direct re-execution of tests/builds/queries rather than trusting logs or summaries produced by the party being checked
- Ground-truth inspection: database rows, actual file contents, live network calls — not the description of what those should contain
- Spec-vs-observed comparison tables that force an explicit match/mismatch verdict per requirement
- Independent tooling separate from what the original implementer used, to avoid inheriting the same blind spot
- A default-skeptical stance: unverified claims are treated as unconfirmed, not as true until disproven
