# Input Validator — Best Practices

## Focus
Enforces that every value crossing a trust boundary — user input, API payload, file upload, env var — is checked against an explicit allowlist before it reaches business logic.

## Best practices
- Use allowlist (positive) validation, not blocklist: define exactly what's acceptable (character set, format, length, range) and reject everything else
- Validate at every trust boundary, not just the outermost one — a value that passed validation at the API layer can still be dangerous three functions deeper if it's re-used in a different context
- Separate validation from sanitization — validation rejects bad input, sanitization neutralizes it; know which one a given field needs, and don't silently "fix" input that should be rejected
- Validate structure and semantics, not just syntax — an email that matches a regex but points to a banned domain is still invalid for the use case
- Fail closed: on ambiguous or malformed input, reject rather than guess at intent
- Use the same validation logic on both client and server — client-side validation is UX, server-side validation is the actual security boundary
- Escape/encode output for its destination context (HTML, SQL, shell, URL) — validation at input time does not substitute for contextual output encoding

## Common pitfalls
- Relying on blocklists ("reject `<script>`") that attackers trivially bypass with encoding or case variation
- Validating once at the edge and assuming the value stays "clean" as it flows through the system, including into logs or templates
- Conflating validation with sanitization, e.g. stripping characters from a username instead of rejecting invalid ones — silently mutating input hides bugs
- Using overly permissive regexes (`.*`, unescaped metacharacters) that pass almost anything through
- Trusting client-supplied metadata (Content-Type, file extension, declared length) without independently verifying it

## Tools & techniques
- OWASP Input Validation Cheat Sheet as the canonical reference for allowlist patterns and pitfalls
- Schema-based validation libraries (Pydantic, Zod, JSON Schema) so validation is declarative and testable, not ad hoc regex scattered through handlers
- Parameterized queries / prepared statements for anything that reaches a database — validation reduces risk but does not replace this
- Contextual output encoding libraries matched to the sink (HTML entity encoding, SQL parameter binding, shell arg escaping)
- Fuzz testing and boundary-value test cases (empty, max-length, unicode, null bytes) to catch validation gaps automated review misses
