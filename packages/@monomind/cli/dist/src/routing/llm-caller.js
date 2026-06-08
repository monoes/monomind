/**
 * Claude Code (headless) LLM caller for semantic-routing fallback.
 *
 * Monomind always runs on top of Claude Code, so low-confidence route
 * classification is delegated to the local `claude` CLI in headless print
 * mode — NOT to the Anthropic API with a managed key. There is no
 * `@anthropic-ai/sdk` dependency and no `ANTHROPIC_API_KEY` requirement: the
 * host's existing Claude Code auth is reused.
 *
 * The returned function matches `LLMFallbackConfig.llmCaller` from
 * `@monomind/routing` — `(prompt: string) => Promise<string>`. When the
 * `claude` CLI is unavailable it throws, which the routing layer already
 * catches and degrades to the best semantic match.
 */
import { spawn, execSync } from 'child_process';
import { tmpdir } from 'os';
/** Default model for routing fallback — Haiku is fast and cheap for slug classification. */
const DEFAULT_ROUTING_MODEL = 'haiku';
/**
 * Max time to wait for a single classification before giving up.
 * `claude --print` is a full headless session (cold start ~10s, can spike),
 * so this is generous; the routing layer degrades to the best semantic match
 * on timeout rather than blocking the caller.
 */
const DEFAULT_TIMEOUT_MS = 45_000;
/** Cap captured output so a runaway child can't grow parent memory unbounded. */
const MAX_OUTPUT = 1024 * 1024; // 1 MB — a slug response is tiny
let claudeAvailable = null;
/** Cheap, cached check that the `claude` CLI is installed and on PATH. */
export function isClaudeCodeAvailable() {
    if (claudeAvailable !== null)
        return claudeAvailable;
    try {
        execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, windowsHide: true });
        claudeAvailable = true;
    }
    catch {
        claudeAvailable = false;
    }
    return claudeAvailable;
}
/**
 * Build an `llmCaller` that delegates a classification prompt to a headless
 * Claude Code agent (`claude --print --model <model> -- <prompt>`).
 *
 * Returns `null` when the `claude` CLI is not available, so callers can omit
 * `llmFallback` entirely and let routing run keyword + semantic only.
 */
export function createClaudeLLMCaller(options = {}) {
    if (!isClaudeCodeAvailable())
        return null;
    const model = options.model ?? DEFAULT_ROUTING_MODEL;
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const cwd = options.cwd ?? tmpdir();
    return (prompt) => new Promise((resolve, reject) => {
        const env = { ...process.env };
        // Don't let the child detect a "nested" session.
        delete env.CLAUDE_SESSION_ID;
        delete env.CLAUDE_PARENT_SESSION_ID;
        // Constrain to a pure one-shot classifier:
        //  --strict-mcp-config (with no --mcp-config) loads ZERO MCP servers, so
        //    the child never loads monomind's own MCP server — avoids latency and
        //    a potential routing→MCP→routing recursion.
        //  --no-session-persistence keeps throwaway classification calls out of
        //    the user's session history.
        //  `--` terminates option parsing so a prompt can't smuggle flags.
        const child = spawn('claude', ['--print', '--model', model, '--strict-mcp-config', '--no-session-persistence', '--', prompt], {
            cwd,
            env,
            // 'ignore' closes stdin at spawn so `claude --print` doesn't block on EOF.
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
        });
        let stdout = '';
        let stderr = '';
        let settled = false;
        const timer = setTimeout(() => {
            if (settled)
                return;
            settled = true;
            // SIGTERM first, then SIGKILL if `claude` ignores it — otherwise a
            // hung child is orphaned and keeps consuming resources.
            try {
                child.kill('SIGTERM');
            }
            catch { /* may already be dead */ }
            const killTimer = setTimeout(() => { try {
                child.kill('SIGKILL');
            }
            catch { /* dead */ } }, 2_000);
            killTimer.unref?.();
            reject(new Error(`claude routing fallback timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        timer.unref?.();
        child.stdout?.on('data', (d) => {
            if (stdout.length < MAX_OUTPUT)
                stdout += d.toString();
        });
        child.stderr?.on('data', (d) => {
            if (stderr.length < MAX_OUTPUT)
                stderr += d.toString();
        });
        child.on('error', (err) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            reject(err);
        });
        child.on('close', (code) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            if (code === 0) {
                resolve(stdout.trim());
            }
            else {
                reject(new Error(stderr.trim() || `claude exited with code ${code}`));
            }
        });
    });
}
//# sourceMappingURL=llm-caller.js.map