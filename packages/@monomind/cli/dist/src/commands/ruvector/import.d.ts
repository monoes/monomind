/**
 * CLI RuVector Import Command
 * Import data from sql.js/JSON memory to RuVector PostgreSQL
 *
 * Usage:
 *   npx monomind ruvector import --input memory-export.json
 *   npx monomind ruvector import --from-memory
 *   npx monomind ruvector import --input data.json --batch-size 100
 *
 * https://github.com/nokhodian/monomind
 */
import type { Command } from '../../types.js';
/**
 * RuVector Import command - import from sql.js/JSON to PostgreSQL
 */
export declare const importCommand: Command;
export default importCommand;
//# sourceMappingURL=import.d.ts.map