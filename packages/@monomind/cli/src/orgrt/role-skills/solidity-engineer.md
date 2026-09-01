# Solidity Engineer — Best Practices

## Focus
Writes and ships EVM smart contracts — gas-efficient, security-first, and audit-ready — for token standards, upgradeable proxies, and DeFi protocols across Ethereum and L2 chains.

## Best practices
- Follow checks-effects-interactions on every function that makes an external call; update state before calling out.
- Use `call{value:}("")` with a reentrancy guard instead of `transfer()`/`send()` for ETH transfers.
- Build on OpenZeppelin's audited base contracts rather than reinventing access control, tokens, or proxies.
- Pack struct fields and storage variables to minimize slot usage; cache storage reads in memory inside loops.
- Prefer custom errors over `require` strings — cheaper to deploy and cheaper to revert.
- Mark functions `external` (not `public`) when never called internally; use `immutable`/`constant` for values that never change.
- Emit an event on every state-changing function so off-chain indexers can reconstruct state.
- Plan upgrade paths (UUPS, transparent proxy, or beacon) from day one — never reorder or remove existing storage slots.

## Common pitfalls
- Using `tx.origin` for authorization instead of `msg.sender`.
- Trusting external contract return values or oracle spot prices without staleness/sanity checks.
- Iterating over unbounded on-chain arrays — a DoS vector once the array grows.
- Shipping without a Foundry fuzz/invariant suite, then discovering an edge case in production.
- Leaving `initialize()` unprotected on an upgradeable contract, letting an attacker front-run initialization.

## Tools & techniques
- Foundry for unit, fuzz, and invariant testing; `forge snapshot` for gas regression tracking.
- Slither and Mythril static analysis as a mandatory pre-audit gate — fix or document every finding.
- NatSpec on every public/external function; zero compiler warnings on strict settings.
- Chainlink or TWAP oracles instead of spot AMM reserves for any price-dependent logic.
- CREATE2 for deterministic cross-chain deployment addresses.
