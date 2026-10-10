# Security Command & MCP Reference

> Monomind includes **MonoFence AI**, providing CLI commands and Model Context Protocol (MCP) tools for scanning prompts, analyzing multi-turn attack escalation, monitoring security performance telemetry, and registering learned threat mitigation patterns.

---

## 1. CLI Commands (`monomind security`)

The CLI `security` command ([`packages/@monomind/cli/src/commands/security.ts`](packages/@monomind/cli/src/commands/security.ts)) exposes 6 subcommands for vulnerability scanning, CVE checking, secret scanning, and MonoFence AI defense:

```bash
monomind security <subcommand> [flags]
```

### Subcommands Matrix

| Subcommand | Description | Key Flags & Options | Reference |
|---|---|---|---|
| `scan` | Run security scan on target (code, dependencies) | `--target/-t <path>` (default `.`), `--depth/-d <quick\|standard\|deep>` (default `standard`), `--type <code\|deps\|all>` (default `all`), `--output/-o <text\|json\|sarif>` (default `text`), `--fix/-f` | [`security-scan-commands.ts → scanCommand`](packages/@monomind/cli/src/commands/security-scan-commands.ts#scanCommand) |
| `cve` | Check CVEs via NVD/OSV or list project vulnerabilities via npm audit | `--check/-c <id>`, `--list/-l`, `--severity/-s <critical\|high\|medium\|low>`, `--json`, `--no-cache` | [`security-cve.ts → cveCommand`](packages/@monomind/cli/src/commands/security-cve.ts#cveCommand) |
| `secrets` | Detect hardcoded secrets in codebase | `--path/-p <dir>` (default `.`), `--depth/-d <quick\|standard\|deep>` (default `standard`) | [`security-scan-commands.ts → secretsCommand`](packages/@monomind/cli/src/commands/security-scan-commands.ts#secretsCommand) |
| `audit` | Read/write the real security audit trail (destructive-ops, secrets, and monofence PreToolUse gate decisions) | `--action/-a <list\|log\|export\|clear>` (default `list`), `--limit/-l <n>` (default `20`), `--filter/-f <substring>`, `--follow` (with `log`), `--output/-o <path>` (required with `export`) | [`security-misc.ts → auditCommand`](packages/@monomind/cli/src/commands/security-misc.ts#auditCommand) |
| `defend` | AI manipulation defense — detect prompt injection, jailbreaks, and PII | `--input/-i <text>`, `--file/-f <path>`, `--quick/-Q`, `--learn/-l` (default `true`), `--stats/-s`, `--output/-o <text\|json>` (default `text`) | [`security-misc.ts → defendCommand`](packages/@monomind/cli/src/commands/security-misc.ts#defendCommand) |
| `redteam` | Red-team prompt library — lists prompt-injection, jailbreak, and manipulation test prompts for manual review by default; with `--target` sends them live as `POST { prompt, category }` and evaluates the `{ response }` via monofence-ai's `scanOutput()` | `--target/-t <url>` (enables live execution), `--dry-run <bool>` (default: `true` iff `--target` absent), `--scenarios/-s <list>` (default `all`), `--iterations/-n <n>` (default `5`, max — that's all that exist), `--output/-o <text\|json>` (default `text`), `--threshold <0-1>` (default `0.1`, live-mode failure-rate gate) | [`security-misc.ts → redteamCommand`](packages/@monomind/cli/src/commands/security-misc.ts#redteamCommand) |

#### `scan --output` formats

- `text` (default): human-readable table + summary box.
- `json`: structured findings (`severity`, `type`, `location`, `description`), a `summary` count block, and `coverage` gap info — printed instead of the table.
- `sarif`: SARIF 2.1.0 document, produced by adapting scan findings into monograph's real SARIF exporter (`exportHealthSarif` in [`packages/@monomind/monograph/src/export/sarif.ts`](packages/@monomind/monograph/src/export/sarif.ts)) rather than a second SARIF implementation.

With `json` or `sarif`, stdout carries only the document, so `monomind security scan -o sarif > results.sarif` gives a valid file. The banner, progress and summary lines go to stderr. The same holds for `cve --json` and `defend -o json`. Errors always go to stderr.

#### MonoFence first-use install

`defend`, `redteam` and the `monofence_*` MCP tools load `monofence-ai` from `~/.monomind/deps`. The first call installs the pinned version there (hash-checked, lockfile shipped with the CLI, `--ignore-scripts`) and loads it without a restart; nothing is installed into your project, and `package.json` and `node_modules` stay untouched. `MONOMIND_NO_AUTO_INSTALL=1` turns the install off and prints the command to run by hand. If the install fails, the command reports the installer's message and does not retry in the same session.

`defend` prints a per-severity result for each detected threat; before 2.24.2 the first detected threat crashed it (#641).

#### Quiet mode

The global `-Q/--quiet` drops the human lines: the banner, spinner progress and "Scan complete". It keeps errors and results. In text mode `scan -Q` still prints the findings and the summary box. **`defend` uses `-Q` for its own `--quick` flag**, so write `--quiet` in full there.

---

## 2. Model Context Protocol (MCP) Security Tools (`monofence_*`)

MonoFence AI exposes 8 dedicated MCP tools through the Monomind MCP server implementation ([`packages/@monomind/cli/src/mcp-tools/security-tools.ts`](packages/@monomind/cli/src/mcp-tools/security-tools.ts#securityTools)).

All tools cap `input` at 64 KB; longer text is cut to that size before scanning.

### 1. `monofence_scan`
Scans input text for AI manipulation threats (prompt injection, jailbreaks, PII).

- **Parameters**:
  - `input` (string, required): the text to scan.
  - `quick` (boolean, default `false`): quick scan, faster and less detailed.
- **Return Payload**: the full scan returns `safe`, a `threats` array (`type`, `severity`, `confidence`, `description` per threat), `piiFound` and `detectionTimeMs`. A quick scan returns `safe`, `threatDetected`, `confidence` and `mode: "quick"`.

### 2. `monofence_analyze`
Deep analysis of an input for specific threat types, with a search for similar known patterns and mitigation recommendations.

- **Parameters**:
  - `input` (string, required): the text to analyze.
  - `searchSimilar` (boolean, default `true`): search for similar known threats.
  - `k` (number, default `5`, at most `100`): how many similar patterns to retrieve.

### 3. `monofence_stats`
Reads the detection and learning statistics of the MonoFence instance.

- **Parameters**: none.
- **Return Payload**: `detectionCount`, `avgDetectionTimeMs`, `learnedPatterns`, `mitigationStrategies` and `avgMitigationEffectiveness`.

### 4. `monofence_learn`
Records detection feedback so future detection improves, and optionally records how a mitigation worked.

- **Parameters**:
  - `input` (string, required): the original input that was scanned.
  - `wasAccurate` (boolean, required): whether the detection was right.
  - `verdict` (string, optional): your verdict or correction.
  - `threatType`, `mitigationStrategy`, `mitigationSuccess` (optional): all three together record a mitigation. `mitigationStrategy` is one of `block`, `sanitize`, `warn`, `log`, `escalate`, `transform`, `redirect`.
- **Return Payload**: `success`, a `message`, and `learnedFrom` (the first 50 characters of the input, `wasAccurate`, `threatCount`).

### 5. `monofence_is_safe`
Quick boolean check that an input is safe. The fastest option for simple validation.

- **Parameters**: `input` (string, required): text to check.

### 6. `monofence_has_pii`
Checks whether an input contains PII (emails, SSNs, API keys, passwords and similar).

- **Parameters**: `input` (string, required): text to check for PII.

### 7. `monofence_scan_output`
Scans an LLM response for PII leakage, prompt echo (trigram Jaccard similarity) and policy violations. Use it after receiving a model response.

- **Parameters**:
  - `output` (string, required): the LLM output text.
  - `originalPrompt` (string, optional): the prompt that produced it; enables echo detection.

### 8. `monofence_context`
Returns the multi-turn context escalation state (`normal`, `suspicious`, `elevated` or `attack`) and the cumulative threat score.

- **Parameters**: `reset` (boolean, default `false`): clear the escalation state to start a new session.

---

## 3. Integration with Lifecycle Hooks

MonoFence AI automatically binds to system execution hooks (`pre-task` and `pre-command`) with critical priority (priority `1000`) via [`packages/monofence-ai/src/hooks/security-hook.ts`](packages/monofence-ai/src/hooks/security-hook.ts#registerSecurityHooks).

When an incoming prompt or command payload yields a threat confidence score $\ge 0.8$ or transitions the context state machine into `attack`, the security hook halts execution immediately and returns a structured intervention block to the caller.
