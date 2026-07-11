/**
 * CLI Guidance Command
 *
 * Wires the enforcement gates (destructive-ops + secrets) into Claude Code hooks.
 * The gates themselves live in .claude/helpers/handlers/gates-handler.cjs — a
 * self-contained regex table that runs on every PreToolUse. This command only
 * registers the hook entries in .claude/settings.json.
 */
import type { Command } from '../types.js';
export declare const guidanceCommand: Command;
export default guidanceCommand;
//# sourceMappingURL=guidance.d.ts.map