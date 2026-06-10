/**
 * CLI MonoVector Import Command
 * Import data from sql.js/JSON memory to MonoVector PostgreSQL
 *
 * Usage:
 *   npx monomind monovector import --input memory-export.json
 *   npx monomind monovector import --from-memory
 *   npx monomind monovector import --input data.json --batch-size 100
 *
 * https://github.com/monoes/monomind
 */
import type { Command } from '../../types.js';
/**
 * MonoVector Import command - import from sql.js/JSON to PostgreSQL
 */
export declare const importCommand: Command;
export default importCommand;
//# sourceMappingURL=import.d.ts.map