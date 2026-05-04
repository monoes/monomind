import type { ResolvedModule } from './types.js';

export function applySpecifierUpgrades(resolved: ResolvedModule[]): void {
  const internalBySpecifier = new Map<string, number>();

  for (const mod of resolved) {
    for (const ri of mod.resolvedImports) {
      if (ri.target.kind === 'InternalModule') {
        internalBySpecifier.set(ri.info.specifier, ri.target.fileId);
      }
    }
  }

  for (const mod of resolved) {
    for (const ri of mod.resolvedImports) {
      if (ri.target.kind === 'NpmPackage') {
        const internalId = internalBySpecifier.get(ri.info.specifier);
        if (internalId !== undefined) {
          ri.target = { kind: 'InternalModule', fileId: internalId };
        }
      }
    }
    for (const rr of mod.resolvedReExports) {
      if (rr.target.kind === 'NpmPackage') {
        const internalId = internalBySpecifier.get(rr.info.specifier);
        if (internalId !== undefined) {
          rr.target = { kind: 'InternalModule', fileId: internalId };
        }
      }
    }
  }
}
