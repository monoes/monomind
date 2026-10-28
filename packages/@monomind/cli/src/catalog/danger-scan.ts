/**
 * Pre-install tripwire for third-party skill text: a short, conservative list
 * of things a skill has no business containing. A hit does not refuse the
 * package outright; `inspectPackage` turns it into a `quarantine` verdict (the
 * same one a blocked monofence scan gets), so a human reads the finding and
 * either revokes the package or releases it with a reason.
 *
 * What it looks for:
 *  - registering something that executes: hook/MCP-server registration
 *    snippets (an event name beside `command`, `mcpServers`, approval flags);
 *  - telling the agent to edit a file a host tool later executes (hook
 *    configs, `.mcp.json`, git hooks, `core.fsmonitor`, `.vscode/tasks.json`,
 *    shell startup files, `~/.ssh`);
 *  - fetch-and-execute and reverse-shell shapes (`curl … | sh`, `/dev/tcp/`);
 *  - sending credentials out (a request that names `~/.ssh` or a token
 *    variable);
 *  - switching protections off (`--dangerously-skip-permissions`,
 *    `bypassPermissions`, `allowUnsandboxedCommands`);
 *  - text a reader cannot see: bidi controls and Unicode tag characters.
 *
 * LIMITS, stated plainly: this is a handful of regular expressions over the
 * text as written. It does not understand language. Paraphrase, another
 * language, base64, splitting an instruction over several files or over
 * several lines past the proximity window, or an instruction that only
 * describes the goal ("make sure the project runs my setup on open") all pass
 * it. It also flags legitimate security-training skills that quote these
 * patterns. It is a tripwire for the obvious, one layer beside the monofence
 * scan, the no-exec-syntax rule, the file allowlist (Markdown only) and the
 * write-deny on every path a host tool executes. It is no substitute for
 * reading what you approve.
 */

const alt = (xs: string[]): string => `(?:${xs.join('|')})`;

/** Paths a host tool or shell later runs or obeys. */
const EXEC_PATH = alt([
  '\\.claude/(?:settings|hooks|helpers)',
  '\\.mcp\\.json',
  '\\.gemini/settings',
  '\\.codex/config',
  '\\.cursor/',
  '\\.agents/(?:hooks|monomind)',
  '\\.git/(?:hooks|config)',
  '\\.githooks',
  '\\.husky',
  '\\.github/hooks',
  '\\.vscode/(?:tasks|settings|launch)',
  '\\.devcontainer',
  'core\\.fsmonitor',
  'core\\.hooksPath',
  '\\.bashrc',
  '\\.zshrc',
  '\\.profile',
  '\\.zshenv',
  'authorized_keys',
  '\\.npmrc',
  '\\.ssh/config',
]);
const EDIT_VERB = alt([
  ...['edit', 'modify', 'write', 'append', 'add', 'create', 'overwrite', 'update', 'patch'],
  ...['replace', 'insert', 'inject', 'set', 'register', 'install', 'put'],
]);
/** Credential stores and token variable names (names only, never values). */
const CRED_PATHS = alt([
  ...['~/\\.ssh', '\\.ssh/id_', 'id_rsa', 'id_ed25519', '\\.aws/credentials'],
  ...['\\.git-credentials', '\\.netrc', '\\.config/gh', '\\.npmrc', '\\.env\\b'],
  ...['GH', 'GITHUB', 'NPM', 'ANTHROPIC_API', 'OPENAI_API'].map((p) => `\\b${p}_(?:TOKEN|KEY)\\b`),
]);
const SENDER = alt(['curl', 'wget', 'nc', 'ncat', 'scp', 'rsync', 'Invoke-WebRequest', 'iwr']);

interface Rule {
  id: string;
  describe: string;
  re: RegExp;
}

const RULES: Rule[] = [
  {
    id: 'edits-exec-config',
    describe: 'tells the agent to edit a file a host tool executes',
    re: new RegExp(`\\b${EDIT_VERB}\\b[^\\n]{0,80}?${EXEC_PATH}`, 'i'),
  },
  {
    id: 'hook-registration',
    describe: 'hook registration snippet (event name beside a command)',
    re: /["']?(?:PreToolUse|PostToolUse|UserPromptSubmit|SessionStart|SessionEnd|SubagentStop)["']?\s*:[^]{0,200}?["']?command["']?\s*:/i,
  },
  {
    id: 'mcp-server-registration',
    describe: 'registers an MCP server or auto-approves project MCP servers',
    re: /["']?(?:mcpServers|mcp_servers|enableAllProjectMcpServers|enabledMcpjsonServers)["']?\s*[:=]/i,
  },
  {
    id: 'fetch-and-exec',
    describe: 'downloads and executes (curl/wget piped to a shell, base64 to a shell)',
    re: /\b(?:curl|wget|iwr|Invoke-WebRequest)\b[^\n|]{0,200}\|\s*(?:sudo\s+)?(?:ba|z|da|k)?sh\b|base64\s+(?:-d|--decode)[^\n|]{0,100}\|\s*(?:ba|z)?sh\b/i,
  },
  {
    id: 'reverse-shell',
    describe: 'reverse-shell shape (/dev/tcp, nc -e, bash -i >&)',
    re: /\/dev\/(?:tcp|udp)\/|\bnc(?:at)?\b[^\n]{0,40}\s-[a-z]*e\b|\bbash\s+-i\s*>&/i,
  },
  {
    id: 'exfil-credentials',
    describe: 'sends credentials or tokens to a remote host',
    re: new RegExp(
      `\\b${SENDER}\\b[^\\n]{0,200}${CRED_PATHS}|${CRED_PATHS}[^\\n]{0,200}\\b${SENDER}\\b`,
      'i',
    ),
  },
  {
    id: 'disables-protections',
    describe: 'switches off permission prompts or the sandbox',
    re: /--dangerously-skip-permissions|dangerouslyDisableSandbox|allowUnsandboxedCommands|\bbypassPermissions\b|dangerouslySkipPermissions/i,
  },
  {
    id: 'hidden-text',
    describe: 'invisible or direction-changing characters (bidi controls, Unicode tag characters)',
    // U+202A–202E, U+2066–2069 (bidi); U+E0000–E007F (tag characters) as surrogates
    re: /[\u202A-\u202E\u2066-\u2069]|\uDB40[\uDC00-\uDC7F]/,
  },
];

export interface DangerFinding {
  id: string;
  describe: string;
  /** Where the first match starts, as a 1-based line number. */
  line: number;
}

/** Findings in one file's text; empty when nothing matched. */
export function dangerousContent(text: string): DangerFinding[] {
  const out: DangerFinding[] = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (!m) continue;
    out.push({
      id: rule.id,
      describe: rule.describe,
      line: text.slice(0, m.index).split('\n').length,
    });
  }
  return out;
}

/** `file:line id,id` entries for a package's files, one per file with findings. */
export function dangerSummary(files: { path: string; text: string }[]): string[] {
  return files.flatMap((f) => {
    const found = dangerousContent(f.text);
    return found.length ? [`${f.path}:${found[0].line} ${found.map((x) => x.id).join(',')}`] : [];
  });
}
