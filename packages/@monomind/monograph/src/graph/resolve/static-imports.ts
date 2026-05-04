import type { ResolveContext, ResolvedImport, ImportInfo } from './types.js';
import { resolveSpecifier, isStyleFile } from './specifier.js';

export function resolveStaticImports(
  ctx: ResolveContext,
  filePath: string,
  imports: ImportInfo[],
): ResolvedImport[] {
  const fromStyle = isStyleFile(filePath);
  return imports.map(info => ({
    info,
    target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
  }));
}
