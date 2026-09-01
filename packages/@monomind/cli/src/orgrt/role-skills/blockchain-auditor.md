# Blockchain Auditor — Best Practices

## Focus
Audits smart contracts and DeFi protocols for exploitable vulnerabilities — combining automated analysis, manual review, and economic attack modeling — before attackers find the bugs first.

## Best practices
- Never skip manual line-by-line review — automated tools catch roughly 30% of real bugs; logic and economic exploits require human analysis.
- Trace the full call chain, not just the immediate function — vulnerabilities hide in internal calls and inherited contracts.
- Require a proof-of-concept or concrete attack scenario with estimated impact for every finding.
- Classify severity honestly: anything that can cause direct fund loss is High or Critical, never softened to Informational.
- Verify audited code matches deployed bytecode — supply-chain substitution is a real attack vector.
- Model incentives and game theory, not just code correctness: is it ever profitable for an actor to deviate from intended behavior?
- Check ERC standard compliance — deviations break composability and open exploit paths.
- Simulate extreme conditions: 99% price drops, zero liquidity, oracle failure, mass liquidation cascades.

## Common pitfalls
- Assuming a function is safe because it uses OpenZeppelin — misuse of safe libraries is its own vulnerability class.
- Missing read-only reentrancy through view functions used as price oracles elsewhere in the system.
- Treating spot AMM reserves as a reliable price source instead of requiring TWAP or Chainlink with staleness checks.
- Under-scoping the review to the changed files only, missing how the change interacts with the rest of the protocol.

## Tools & techniques
- Slither and Mythril for automated static/symbolic analysis; Echidna or Foundry invariant tests for property-based fuzzing.
- Severity ladder: Critical (unconditional fund loss/insolvency) → High (conditional loss/privilege escalation) → Medium (griefing/temporary DoS) → Low → Informational.
- Access control checklist: role hierarchy, initialization guards, upgrade authorization, external call validation.
- Audit report structure: executive summary, scope table, per-finding location/description/impact/PoC/recommendation.
- Reference libraries: SWC Registry, rekt.news, DeFiHackLabs, Trail of Bits and OpenZeppelin audit archives for known exploit patterns.
