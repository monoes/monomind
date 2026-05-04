export type DepCategory =
  | "dependencies"
  | "devDependencies"
  | "optionalDependencies"
  | "peerDependencies";

export interface UnusedDepResult {
  name: string;
  category: DepCategory;
  reason: string;
}

export interface UnresolvedImportResult {
  specifier: string;
  filePath: string;
}

export interface DepCategoryConfig {
  skipDev?: boolean;
  skipOptional?: boolean;
  skipPeer?: boolean;
}

export function findUnusedDependencies(
  usedPackages: Set<string>,
  declaredDeps: Record<DepCategory, string[]>,
  config: DepCategoryConfig = {}
): UnusedDepResult[] {
  const results: UnusedDepResult[] = [];

  const categories: Array<{ key: DepCategory; skip?: boolean }> = [
    { key: "dependencies" },
    { key: "devDependencies", skip: config.skipDev },
    { key: "optionalDependencies", skip: config.skipOptional },
    { key: "peerDependencies", skip: config.skipPeer },
  ];

  for (const { key, skip } of categories) {
    if (skip) continue;
    const deps = declaredDeps[key] ?? [];
    for (const dep of deps) {
      if (!usedPackages.has(dep)) {
        results.push({
          name: dep,
          category: key,
          reason: `declared in ${key} but never imported`,
        });
      }
    }
  }

  return results;
}

export function findUnresolvedImports(
  importSpecifiers: Array<{ specifier: string; filePath: string }>,
  resolvedPackages: Set<string>
): UnresolvedImportResult[] {
  return importSpecifiers.filter(({ specifier }) => !resolvedPackages.has(specifier));
}

export function findTypeOnlyDependencies(
  usedInProduction: Set<string>,
  usedInTypes: Set<string>,
  deps: string[]
): string[] {
  return deps.filter(
    (dep) => !usedInProduction.has(dep) && usedInTypes.has(dep)
  );
}
