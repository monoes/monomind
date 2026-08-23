import { isStyleFile, resolveSpecifier } from './specifier.js';
import type { ImportInfo, ResolveContext, ResolvedImport } from './types.js';

export function resolveStaticImports(
  ctx: ResolveContext,
  filePath: string,
  imports: ImportInfo[],
): ResolvedImport[] {
  const fromStyle = isStyleFile(filePath);
  return imports.map((info) => ({
    info,
    target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
  }));
}
