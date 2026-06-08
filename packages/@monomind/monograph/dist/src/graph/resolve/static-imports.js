import { resolveSpecifier, isStyleFile } from './specifier.js';
export function resolveStaticImports(ctx, filePath, imports) {
    const fromStyle = isStyleFile(filePath);
    return imports.map(info => ({
        info,
        target: resolveSpecifier(ctx, filePath, info.specifier, fromStyle),
    }));
}
//# sourceMappingURL=static-imports.js.map