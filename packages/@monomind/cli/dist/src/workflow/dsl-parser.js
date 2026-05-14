import { readFileSync } from 'node:fs';
import YAML from 'yaml';
import { workflowDefinitionSchema, } from './dsl-schema.js';
export class DSLParser {
    /**
     * Load and validate a workflow definition from a YAML or JSON file.
     */
    static loadFromFile(filePath) {
        const raw = readFileSync(filePath, 'utf-8');
        const parsed = filePath.endsWith('.json') ? JSON.parse(raw) : YAML.parse(raw);
        return DSLParser.loadFromObject(parsed);
    }
    /**
     * Validate an unknown object against the workflow definition schema.
     */
    static loadFromObject(raw) {
        return workflowDefinitionSchema.parse(raw);
    }
}
//# sourceMappingURL=dsl-parser.js.map