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
    /**
     * Merge a single parsed flag (or set of `_` positionals) into the
     * accumulated result flags, collecting repeats into an array instead of
     * overwriting. Declared `type: 'array'` options always end up as an array
     * (even a single occurrence); any other repeated flag also becomes an
     * array on its second occurrence rather than silently dropping the first
     * value.
     */
    private mergeParsedFlags;
    parse(args: string[]): ParseResult;
    /**
     * Convert a camelCase key to kebab-case (inverse of normalizeKey).
     */
    private camelToKebab;
    /**
     * Ensure every flag is reachable under both its camelCase and
     * kebab-case spelling. Runs once, after all flags (including
     * defaults) have been merged into the result.
     */
    private mirrorFlagKeys;
    /**
     * True when `value` looks like a space-separated negative number
     * (`-0.5`, `-42`) rather than a new flag. Scoped narrowly to "leading `-`
     * immediately followed by a digit" — a legitimate flag name never starts
     * with a digit, so this can't misfire on a genuine following flag while
     * still letting `--threshold -0.5` consume `-0.5` as the value instead of
     * being misparsed as a new (bogus) flag.
     */
    private looksLikeNegativeNumber;
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
    /**
     * Get flags declared `type: 'array'`, scoped to a specific command/subcommand.
     */
    private getScopedArrayFlags;
    private getBooleanFlags;
    private applyDefaults;
    validateFlags(flags: ParsedFlags, command?: Command): string[];
    getGlobalOptions(): CommandOption[];
}
export declare const commandParser: CommandParser;
//# sourceMappingURL=parser.d.ts.map