export interface FixerAnalysisResults {
  unusedExports: unknown[];
  unusedDependencies: unknown[];
  unusedEnumMembers: unknown[];
}

export interface FixOptions {
  root: string;
  output: 'human' | 'json';
  dryRun: boolean;
  yes: boolean;
  quiet: boolean;
}

export interface FixRecord {
  file: string;
  kind: string;
  name: string;
  applied: boolean;
  dryRun: boolean;
}

export type FixApplier = (root: string, results: FixerAnalysisResults, dryRun: boolean, out: FixRecord[]) => Promise<boolean>;

export async function runFix(
  results: FixerAnalysisResults,
  opts: FixOptions,
  appliers: {
    exports?: FixApplier;
    deps?: FixApplier;
    enumMembers?: FixApplier;
  } = {},
): Promise<{ exitCode: number }> {
  const isTTY = Boolean(process.stdin.isTTY);
  if (!opts.dryRun && !opts.yes && !isTTY) {
    const msg = 'fix requires --yes in non-interactive environments. Use --dry-run to preview first.';
    if (opts.output === 'json') console.log(JSON.stringify({ error: msg }));
    else console.error(`Error: ${msg}`);
    return { exitCode: 2 };
  }

  const total = results.unusedExports.length + results.unusedDependencies.length + results.unusedEnumMembers.length;
  if (total === 0) {
    if (opts.output === 'json') console.log(JSON.stringify({ dryRun: opts.dryRun, fixes: [], total_fixed: 0 }));
    else if (!opts.quiet) console.error('No issues to fix.');
    return { exitCode: 0 };
  }

  const fixes: FixRecord[] = [];
  let hadError = false;

  if (appliers.exports && results.unusedExports.length > 0)
    hadError ||= await appliers.exports(opts.root, results, opts.dryRun, fixes);
  if (appliers.deps && results.unusedDependencies.length > 0)
    hadError ||= await appliers.deps(opts.root, results, opts.dryRun, fixes);
  if (appliers.enumMembers && results.unusedEnumMembers.length > 0)
    hadError ||= await appliers.enumMembers(opts.root, results, opts.dryRun, fixes);

  if (opts.output === 'json') {
    const applied = fixes.filter(f => f.applied).length;
    console.log(JSON.stringify({ dryRun: opts.dryRun, fixes, total_fixed: applied }, null, 2));
  } else if (!opts.quiet) {
    if (opts.dryRun) console.error('Dry run complete. No files were modified.');
    else console.error(`Fixed ${fixes.filter(f => f.applied).length} issue(s).`);
  }
  return { exitCode: hadError ? 2 : 0 };
}
