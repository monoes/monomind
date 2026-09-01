# Threat Detection — Best Practices

## Focus
Builds and tunes the detection layer that catches attackers after they bypass preventive controls — SIEM rules, ATT&CK coverage mapping, and threat hunting that converts into automated detections.

## Best practices
- Map every detection rule to at least one MITRE ATT&CK technique — if you can't map it, you don't understand what it detects
- Write rules in a vendor-agnostic format (Sigma) first, then compile to target SIEMs, so detection logic isn't locked to one platform
- Prefer behavioral detections (process chains, anomalous sequences) over static IOC matching (IPs, hashes) — attackers rotate indicators daily
- Document a false-positive profile for every rule before deployment — if you don't know what benign activity triggers it, it isn't tested
- Prioritize coverage gaps by threat intelligence relevant to your actual environment/industry, not theoretical attacks from conference talks
- Treat detection rules as code: version-controlled, peer-reviewed, tested against sample data, deployed via CI — never edited live in a console
- Convert every successful threat hunt into an automated detection — manual discoveries that don't become rules will be missed next time

## Common pitfalls
- Deploying untested rules that either fire on everything or never fire at all
- Chasing detection quantity over quality — a noisy SIEM trains analysts to ignore alerts, which is worse than no detection
- Detecting only initial access and missing lateral movement, persistence, and exfiltration further down the kill chain
- Assuming a log source is being collected without verifying it — a detection is worthless if its data source silently stopped ingesting
- Never re-validating old rules — a detection that worked a year ago may not catch today's technique variant

## Tools & techniques
- MITRE ATT&CK matrix for coverage mapping and gap prioritization, tracked per platform (Windows/Linux/Cloud/Containers)
- Sigma rule format for vendor-agnostic detection-as-code, compiled to Splunk SPL / Sentinel KQL / Elastic EQL
- Atomic Red Team or purple-team exercises to validate that a detection actually fires on the targeted technique
- Detection-as-code CI pipeline: syntax validation, required-field checks (ATT&CK tags, false-positive docs), automated compile-and-deploy
- Efficacy metrics tracked over time: true/false positive rate, mean time to detect, alert-to-incident conversion rate
