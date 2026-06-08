import type { PipelinePhase } from '../types.js';
export interface FieldDef {
    name: string;
    type: string;
    fieldNodeId: string;
}
export interface EntityDef {
    name: string;
    filePath: string;
    fields: FieldDef[];
    entityNodeId: string;
}
export interface OrmOutput {
    entities: EntityDef[];
}
export declare const ormPhase: PipelinePhase<OrmOutput>;
//# sourceMappingURL=orm.d.ts.map