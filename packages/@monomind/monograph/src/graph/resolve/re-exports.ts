import { isStyleFile, resolveSpecifier } from './specifier.js';
import type { ReExportInfo, ResolveContext, ResolvedReExport } from './types.js';

export function resolveReExports(
  ctx: ResolveContext,
  filePath: string,
  reExports: ReExportInfo[],
): ResolvedReExport[] {
  const fromStyle = isStyleFile(filePath);
  return reExports.map((info) => ({
    info,
    target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
  }));
}
