/**
 * Thin wrapper around `claude --print` for LLM calls inside monograph.
 * Reuses Claude Code's existing auth — no ANTHROPIC_API_KEY needed.
 */
import { spawn, execSync } from 'child_process';

const DEFAULT_TIMEOUT_MS = 60_000;
let _available: boolean | null = null;

export function isClaudeCliAvailable(): boolean {
  if (_available !== null) return _available;
  try {
    execSync('claude --version', { encoding: 'utf-8', stdio: 'pipe', timeout: 5000, windowsHide: true });
    _available = true;
  } catch {
    _available = false;
  }
  return _available;
}

export function claudeCliCall(prompt: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'claude',
      ['--print', '--model', 'haiku', '--strict-mcp-config', '--no-session-persistence', '--', prompt],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch { /* ignore */ }
      setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* ignore */ } }, 3000);
      reject(new Error(`claude --print timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `claude exited with code ${code}`));
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
  });
}
