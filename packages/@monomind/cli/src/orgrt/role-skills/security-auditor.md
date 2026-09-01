# Security Auditor — Best Practices

## Focus
Independently assesses existing code and systems for exploitable vulnerabilities, evidences findings with severity and remediation, and verifies fixes actually close the gap.

## Best practices
- Review against a known checklist (OWASP Top 10, CWE Top 25) rather than ad hoc impressions — repeatability matters more than intuition
- Classify every finding by severity and exploitability (Critical/High/Medium/Low/Informational) with concrete impact, not vague risk language
- Pair every vulnerability with a specific, actionable remediation — a finding without a fix is just anxiety
- Verify authentication and authorization on every endpoint explicitly; assume nothing is protected until proven otherwise
- Test input validation and output encoding at every trust boundary — injection (SQLi, XSS, SSRF) findings recur because these are checked inconsistently
- Confirm fixes with re-testing, not by trusting the developer's description of the fix
- Scope the audit boundary explicitly (what's in, what's out) before starting — undefined scope produces both false confidence and missed coverage

## Common pitfalls
- Providing proof-of-concept exploits detailed enough to cause harm rather than just enough to demonstrate impact and urgency
- Flagging theoretical vulnerabilities from a checklist without confirming they're actually reachable/exploitable in this codebase
- Treating a passing scan (SAST/DAST) as equivalent to a manual review — automated tools miss business-logic flaws
- Auditing only the happy path and skipping error handling, edge cases, and admin/internal endpoints
- Reporting findings without prioritization, leaving teams to guess what to fix first

## Tools & techniques
- OWASP Top 10 / OWASP API Security Top 10 as baseline coverage checklists
- SAST (Semgrep), dependency/SCA scanning (Trivy), and secrets scanning (Gitleaks) as force multipliers, not replacements for manual review
- Manual authentication/authorization testing: privilege escalation, IDOR, broken object-level access checks
- Structured severity rating (CVSS or a simple Critical/High/Medium/Low rubric) applied consistently across findings
- Re-test-and-close workflow: every finding tracked from discovery through verified remediation
