import { resolveSpecifier } from './specifier.js';
export function resolveRequireImports(ctx, filePath, requireCalls) {
    return requireCalls.map(req => {
        const info = { specifier: req.specifier, isDynamic: true, span: req.span };
        return { info, target: resolveSpecifier(ctx, filePath, req.specifier, false) };
    });
}
//# sourceMappingURL=require-imports.js.map