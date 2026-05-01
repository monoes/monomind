import type { PipelinePhase, PipelineContext } from '../types.js';
import type { ParseOutput } from './parse.js';
import { extractVariables, variableToNode } from './variables.js';

export interface VariablesOutput {
  variableCount: number;
}

export const variablesPhase: PipelinePhase<VariablesOutput> = {
  name: 'variables',
  deps: ['parse'],
  async execute(ctx: PipelineContext, deps: Map<string, unknown>): Promise<VariablesOutput> {
    const { fileContents } = deps.get('parse') as ParseOutput;

    const stmt = ctx.db.prepare(`
      INSERT OR IGNORE INTO nodes (id, label, name, norm_label, file_path, start_line, end_line, is_exported)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let variableCount = 0;
    for (const [filePath, source] of fileContents) {
      const vars = extractVariables(source, filePath);
      for (const v of vars) {
        const node = variableToNode(v);
        stmt.run(
          node.id, node.label, node.name, node.normLabel ?? node.name.toLowerCase(),
          node.filePath ?? null, node.startLine ?? null, node.endLine ?? null,
          node.isExported ? 1 : 0,
        );
        variableCount++;
      }
    }

    return { variableCount };
  },
};
