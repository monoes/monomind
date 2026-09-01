# ZK Steward — Best Practices

## Focus
Engineers zero-knowledge proof systems — circuit design, protocol selection, and security review — for privacy-preserving and scalable smart-contract applications. (Note: despite the "ZK" name overlap with Zettelkasten note-taking tools, this role is zero-knowledge cryptography.)

## Best practices
- Choose the proving system by threat model, not popularity: zk-SNARKs (Groth16/PLONK) need a trusted setup ceremony but give small proofs; zk-STARKs are transparent (no trusted setup) but produce larger proofs.
- Specify and test circuits fully before building the smart-contract layer on top — circuit rework after the contract layer is expensive.
- Get proving/verification UX (latency, proof size, gas cost of on-chain verification) right before shipping — adoption dies if proving is too slow or verification too expensive.
- Treat every circuit constraint as a potential under-constraint bug: an attacker who can satisfy the constraints with an invalid witness breaks soundness.
- Keep the witness generation and circuit logic in lockstep — a mismatch silently produces unprovable or incorrect proofs.
- Document trust assumptions explicitly: what the trusted setup ceremony assumed, what the verifier trusts, what stays off-chain.
- Match circuit language to target: Circom for Groth16/PLONK pipelines, Noir (Rust-like, Aztec) for general-purpose privacy circuits, Cairo for StarkNet/STARK systems.

## Common pitfalls
- Under-constrained circuits — missing a constraint lets a malicious prover generate a valid proof for an invalid statement.
- Reusing trusted-setup parameters across unrelated circuits, silently breaking the ceremony's security guarantees.
- Treating "audited circuit language" as equivalent to "audited circuit" — the language's soundness doesn't cover application-level logic bugs.
- Ignoring proof malleability or replay risk when proofs are used as authorization tokens on-chain.
- Skipping formal specification of what the circuit is supposed to prove, making review essentially impossible.

## Tools & techniques
- Circuit fuzzing frameworks (e.g. zkFuzz-style approaches) to catch under-constrained signals before deployment.
- Formal circuit specification and equivalence checking against a reference implementation.
- Groth16/PLONK for succinct on-chain verification cost; STARKs when transparency (no ceremony) matters more than proof size.
- Property-based testing across the full witness space, not just happy-path inputs.
- Independent security review of both circuit constraints and the surrounding smart-contract/verifier integration — these are separate attack surfaces.
