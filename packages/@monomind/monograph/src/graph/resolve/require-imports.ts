import { resolveSpecifier } from './specifier.js';
import type { ImportInfo, ResolveContext, ResolvedImport } from './types.js';

export interface RequireCallInfo {
  specifier: string;
  span?: { start: number; end: number };
}

export function resolveRequireImports(
  ctx: ResolveContext,
  filePath: string,
  requireCalls: RequireCallInfo[],
): ResolvedImport[] {
  return requireCalls.map((req) => {
    const info: ImportInfo = { specifier: req.specifier, isDynamic: true, span: req.span };
    return { info, target: resolveSpecifier(ctx, filePath, req.specifier, false) };
  });
}
