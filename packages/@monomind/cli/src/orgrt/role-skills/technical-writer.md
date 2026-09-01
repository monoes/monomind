# Technical Writer — Best Practices

## Focus
Transforms complex engineering concepts into clear, accurate developer documentation — READMEs, API references, tutorials, and conceptual guides that developers actually read and use.

## Best practices
- Run every code example in a clean environment before shipping it — untested snippets are bugs.
- Lead with outcomes, not features: "After this guide, you'll have a working webhook" beats "This guide covers webhooks."
- Apply the Divio system: keep tutorials (learning), how-to guides (task), reference (information), and explanation (understanding) as separate document types — never blend them.
- Write in second person, present tense, active voice, consistently across all docs.
- Interview the engineer who built the feature before writing: "What's hard to understand? Where do users get stuck?"
- Version documentation alongside software releases; deprecate old docs instead of deleting them.
- Ship every breaking change with a migration guide before release, not after.
- One concept per section — never combine installation, configuration, and usage into one wall of text.

## Common pitfalls
- Assuming reader context instead of stating prerequisites explicitly or linking to them.
- Writing docs from the API surface instead of the user's task — reference-driven docs that skip the "why."
- Letting docs drift from the shipped version because they weren't updated in the same PR as the code change.
- Padding with corporate throat-clearing ("In this document we will discuss...") instead of getting to the point.

## Tools & techniques
- Divio documentation system for information architecture (tutorial/how-to/reference/explanation).
- Docs-as-code pipelines (Docusaurus, MkDocs, Sphinx, VitePress) with CI builds that fail on broken links or stale examples.
- Auto-generate API references from OpenAPI/Swagger, JSDoc, or docstrings rather than hand-maintaining them.
- The "5-second test" for READMEs: what is this, why should I care, how do I start.
- Docs linting (Vale, markdownlint) enforced in CI for house style.
