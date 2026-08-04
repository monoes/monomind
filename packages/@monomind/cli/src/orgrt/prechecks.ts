// packages/@monomind/cli/src/orgrt/prechecks.ts

export interface Precheck {
  name: string;
  command: string;
}

export interface PrecheckResult {
  name: string;
  passed: boolean;
  output?: string;
}

/** Run all prechecks sequentially. Returns on first failure or after all pass. */
export async function runPrechecks(checks: Precheck[], cwd: string): Promise<{ ok: boolean; results: PrecheckResult[] }> {
  const { execSync } = await import('node:child_process');
  const results: PrecheckResult[] = [];

  for (const check of checks) {
    try {
      const output = execSync(check.command, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).trim();
      results.push({ name: check.name, passed: true, output });
    } catch (err) {
      const output = (err as { stderr?: string; stdout?: string }).stderr
        || (err as { stdout?: string }).stdout
        || (err as Error).message;
      results.push({ name: check.name, passed: false, output: String(output).trim() });
      return { ok: false, results };
    }
  }
  return { ok: true, results };
}
