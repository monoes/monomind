import type { ResolveContext, ResolvedReExport, ReExportInfo } from './types.js';
import { resolveSpecifier, isStyleFile } from './specifier.js';

export function resolveReExports(
  ctx: ResolveContext,
  filePath: string,
  reExports: ReExportInfo[],
): ResolvedReExport[] {
  const fromStyle = isStyleFile(filePath);
  return reExports.map(info => ({
    info,
    target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
  }));
}
