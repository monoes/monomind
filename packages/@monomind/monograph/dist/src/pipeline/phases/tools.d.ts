import type { PipelinePhase } from '../types.js';
export interface ToolDef {
    name: string;
    filePath: string;
    description?: string;
    handlerNodeId?: string;
    toolNodeId: string;
}
export interface ToolsOutput {
    toolDefs: ToolDef[];
}
export declare const toolsPhase: PipelinePhase<ToolsOutput>;
//# sourceMappingURL=tools.d.ts.map