# QA checklist (given to the QA role only)

Verify the implementer's final commit, against the repository's own stated rules as well as the task:

1. The ISO-8601 time form parses: `PT1H30M`, `PT45S`, `PT2H`; an empty `PT` does not.
2. Compound durations still parse, largest unit first; out-of-order and repeated units do not.
3. The module's header comment is part of its contract: whitespace inside a duration is an error and
   only the ends are trimmed. Check it with inputs such as `1h 30m`, `1 h`, `PT1H 30M`.
4. Everything that parsed or was rejected before still does.

Report each command you ran and its result. If a check fails, reject the change summary with the failing
input as the reason, and write `Verdict: fail`; when the implementer republishes, verify again.
