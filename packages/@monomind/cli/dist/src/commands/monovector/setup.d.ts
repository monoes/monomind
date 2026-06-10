/**
 * CLI MonoVector Setup Command
 * Outputs Docker files and SQL for easy MonoVector PostgreSQL setup
 *
 * Usage:
 *   npx monomind monovector setup              # Output to ./monovector-postgres/
 *   npx monomind monovector setup --output /path/to/dir
 *   npx monomind monovector setup --print      # Print to stdout only
 *
 * https://github.com/monoes/monomind
 */
import type { Command } from '../../types.js';
/**
 * MonoVector Setup command - outputs Docker files and SQL
 */
export declare const setupCommand: Command;
export default setupCommand;
//# sourceMappingURL=setup.d.ts.map