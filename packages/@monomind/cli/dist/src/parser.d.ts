/**
 * CLI Command Parser
 * Advanced argument parsing with validation and type coercion
 */
import type { Command, CommandOption, ParsedFlags } from './types.js';
export interface ParseResult {
    command: string[];
    flags: ParsedFlags;
    positional: string[];
    raw: string[];
}
export interface ParserOptions {
    stopAtFirstNonFlag?: boolean;
    allowUnknownFlags?: boolean;
    booleanFlags?: string[];
    stringFlags?: string[];
    arrayFlags?: string[];
    aliases?: Record<string, string>;
    defaults?: Record<string, unknown>;
}
export declare class CommandParser {
    private options;
    private commands;
    private globalOptions;
    constructor(options?: ParserOptions);
    private initializeGlobalOptions;
    registerCommand(command: Command): void;
    getCommand(name: string): Command | undefined;
    getAllCommands(): Command[];
    /**
     * Reserved keys that would either pollute the prototype chain (`__proto__`,
     * `constructor`, `prototype`) or shadow `Object.prototype` methods that
     * downstream consumers commonly call (`hasOwnProperty`, `toString`,
     * `valueOf`, `isPrototypeOf`, `propertyIsEnumerable`). All are rejected.
     */
    private static readonly RESERVED_FLAG_KEYS;
    private setFlagSafe;
    parse(args: string[]): ParseResult;
    private parseFlag;
    private parseValue;
    private normalizeKey;
    private buildAliases;
    /**
     * Build aliases scoped to a specific command/subcommand.
     * The resolved command's short flags take priority over global ones,
     * fixing collisions where multiple subcommands use the same short flag (e.g. -t).
     */
    private buildScopedAliases;
    /**
     * Get boolean flags scoped to a specific command/subcommand.
     */
    private getScopedBooleanFlags;
    private getBooleanFlags;
    private applyDefaults;
    validateFlags(flags: ParsedFlags, command?: Command): string[];
    getGlobalOptions(): CommandOption[];
}
export declare const commandParser: CommandParser;
//# sourceMappingURL=parser.d.ts.map