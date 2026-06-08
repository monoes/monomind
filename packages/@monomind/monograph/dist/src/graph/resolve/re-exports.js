import { resolveSpecifier, isStyleFile } from './specifier.js';
export function resolveReExports(ctx, filePath, reExports) {
    const fromStyle = isStyleFile(filePath);
    return reExports.map(info => ({
        info,
        target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
    }));
}
//# sourceMappingURL=re-exports.js.map