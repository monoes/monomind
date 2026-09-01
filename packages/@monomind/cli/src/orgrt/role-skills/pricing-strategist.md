# Pricing Strategist — Best Practices

## Focus
Designs pricing and packaging that captures value, drives growth, and matches customer willingness to pay — covering strategy, tier architecture, and pricing-page design.

## Best practices
- Separate the three pricing axes explicitly: packaging (what's included per tier), pricing metric (what you charge for), and price point (the actual dollar amount) — don't conflate them.
- Choose a value metric that scales with customer value: ask "as usage of this metric grows, does the customer get proportionally more value?" If yes, it's a good metric to charge on.
- Default to a Good-Better-Best three-tier structure with the middle tier as the anchor most customers should land on; use the top tier to make the middle tier look reasonable.
- Choose freemium only when there's viral/network effect, low marginal cost per free user, and a clear upgrade trigger; choose free trial when the product needs time/setup to show value or serves B2B buying committees.
- Gate enterprise features (SSO/SAML, audit logs, custom contracts) behind a "Contact Sales" tier once deals exceed roughly $10k ARR or require procurement.
- On pricing pages, visually flag the recommended plan, show an annual-toggle with stated savings, and answer "which plan is right for me?" directly in an FAQ.

## Common pitfalls
- Charging on a metric that doesn't correlate with delivered value (e.g., flat per-seat pricing for a product whose value scales with usage, not headcount).
- Adding tiers without clear differentiation — feature overlap between tiers confuses buyers and stalls upgrades.
- Skipping willingness-to-pay research (Van Westendorp, customer interviews) and setting prices from gut feel or competitor mimicry alone.
- Building a pricing page with no anchor, no recommended-plan signal, and no objection-handling FAQ.
- Ignoring cost-to-serve entirely — it should be a floor check, not the pricing basis, but it still needs to be checked.

## Tools & techniques
- Value-based pricing frame: perceived value is the ceiling, next-best alternative is the floor, cost to serve is a sanity check only.
- Tier-count decision rule: 2 tiers for a clean SMB/Enterprise split, 3 as the industry-standard default, 4+ only when granularity outweighs decision paralysis risk.
- Pricing psychology levers: anchoring (show highest tier first), decoy effect, charm vs. round-number pricing, rule of 100 for discount framing.
- Benchmark checks: <30% of customers on the lowest tier and >50% on the middle tier signals healthy tier design; 15-25% trial-to-paid (credit card required) is a reasonable self-serve target.
