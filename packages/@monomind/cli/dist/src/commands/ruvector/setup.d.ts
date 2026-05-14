/**
 * CLI RuVector Setup Command
 * Outputs Docker files and SQL for easy RuVector PostgreSQL setup
 *
 * Usage:
 *   npx monomind ruvector setup              # Output to ./ruvector-postgres/
 *   npx monomind ruvector setup --output /path/to/dir
 *   npx monomind ruvector setup --print      # Print to stdout only
 *
 * https://github.com/nokhodian/monomind
 */
import type { Command } from '../../types.js';
/**
 * RuVector Setup command - outputs Docker files and SQL
 */
export declare const setupCommand: Command;
export default setupCommand;
//# sourceMappingURL=setup.d.ts.map