import { type WorkflowDefinition } from './dsl-schema.js';
export declare class DSLParser {
    /**
     * Load and validate a workflow definition from a YAML or JSON file.
     */
    static loadFromFile(filePath: string): WorkflowDefinition;
    /**
     * Validate an unknown object against the workflow definition schema.
     */
    static loadFromObject(raw: unknown): WorkflowDefinition;
}
//# sourceMappingURL=dsl-parser.d.ts.map