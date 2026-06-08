import { extractVariables, variableToNode } from './variables.js';
export const variablesPhase = {
    name: 'variables',
    deps: ['parse'],
    async execute(ctx, deps) {
        const { fileContents } = deps.get('parse');
        const stmt = ctx.db.prepare(`
      INSERT OR IGNORE INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, is_exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
        let variableCount = 0;
        for (const [filePath, source] of fileContents) {
            const vars = extractVariables(source, filePath);
            for (const v of vars) {
                const node = variableToNode(v);
                stmt.run(node.id, node.label, node.name, node.normLabel ?? node.name.toLowerCase(), node.filePath ?? null, node.startLine ?? null, node.endLine ?? null, node.isExported ? 1 : 0);
                variableCount++;
            }
        }
        return { variableCount };
    },
};
//# sourceMappingURL=variables-phase.js.map