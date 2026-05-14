/**
 * CLI Command Parser
 * Advanced argument parsing with validation and type coercion
 */
export class CommandParser {
    options;
    commands = new Map();
    globalOptions = [];
    constructor(options = {}) {
        this.options = {
            stopAtFirstNonFlag: false,
            allowUnknownFlags: false,
            ...options
        };
        this.initializeGlobalOptions();
    }
    initializeGlobalOptions() {
        this.globalOptions = [
            {
                name: 'help',
                short: 'h',
                description: 'Show help information',
                type: 'boolean',
                default: false
            },
            {
                name: 'version',
                short: 'V',
                description: 'Show version number',
                type: 'boolean',
                default: false
            },
            {
                name: 'verbose',
                short: 'v',
                description: 'Enable verbose output',
                type: 'boolean',
                default: false
            },
            {
                name: 'quiet',
                short: 'Q',
                description: 'Suppress non-essential output',
                type: 'boolean',
                default: false
            },
            {
                name: 'config',
                short: 'c',
                description: 'Path to configuration file',
                type: 'string'
            },
            {
                name: 'format',
                // Note: removed global short flag 'f' — it collides with 50+ subcommand
                // flags (force, follow, file, feature, full) causing unpredictable behavior
                // depending on parser resolution order (#1425). Use --format instead.
                description: 'Output format (text, json, table)',
                type: 'string',
                default: 'text',
                choices: ['text', 'json', 'table']
            },
            {
                name: 'no-color',
                description: 'Disable colored output',
                type: 'boolean',
                default: false
            },
            {
                name: 'interactive',
                short: 'i',
                description: 'Enable interactive mode',
                type: 'boolean',
                default: true
            }
        ];
    }
    registerCommand(command) {
        this.commands.set(command.name, command);
        if (command.aliases) {
            for (const alias of command.aliases) {
                this.commands.set(alias, command);
            }
        }
    }
    getCommand(name) {
        return this.commands.get(name);
    }
    getAllCommands() {
        // Return unique commands (filter out aliases)
        const seen = new Set();
        return Array.from(this.commands.values()).filter(cmd => {
            if (seen.has(cmd))
                return false;
            seen.add(cmd);
            return true;
        });
    }
    /**
     * Reserved keys that would either pollute the prototype chain (`__proto__`,
     * `constructor`, `prototype`) or shadow `Object.prototype` methods that
     * downstream consumers commonly call (`hasOwnProperty`, `toString`,
     * `valueOf`, `isPrototypeOf`, `propertyIsEnumerable`). All are rejected.
     */
    static RESERVED_FLAG_KEYS = new Set([
        '__proto__', 'constructor', 'prototype',
        'hasOwnProperty', 'toString', 'valueOf', 'isPrototypeOf', 'propertyIsEnumerable',
    ]);
    setFlagSafe(flags, key, value) {
        if (CommandParser.RESERVED_FLAG_KEYS.has(key))
            return;
        flags[key] = value;
    }
    parse(args) {
        const result = {
            command: [],
            flags: { _: [] },
            positional: [],
            raw: [...args]
        };
        // Pass 1: Identify command and subcommand (skip flags)
        let resolvedCmd;
        let resolvedSub;
        for (const arg of args) {
            if (arg.startsWith('-'))
                continue;
            if (!resolvedCmd && this.commands.has(arg)) {
                resolvedCmd = this.commands.get(arg);
            }
            else if (resolvedCmd && !resolvedSub && resolvedCmd.subcommands) {
                resolvedSub = resolvedCmd.subcommands.find(sc => sc.name === arg || sc.aliases?.includes(arg));
            }
        }
        // Pass 2: Build aliases scoped to the resolved subcommand
        // Subcommand-specific aliases take priority over global ones
        const aliases = this.buildScopedAliases(resolvedSub || resolvedCmd);
        const booleanFlags = this.getScopedBooleanFlags(resolvedSub || resolvedCmd);
        let i = 0;
        let parsingFlags = true;
        while (i < args.length) {
            const arg = args[i];
            // Check for end of flags marker
            if (arg === '--') {
                parsingFlags = false;
                i++;
                continue;
            }
            // Handle flags
            if (parsingFlags && arg.startsWith('-')) {
                const parseResult = this.parseFlag(args, i, aliases, booleanFlags);
                // Apply to result flags
                Object.assign(result.flags, parseResult.flags);
                i = parseResult.nextIndex;
                continue;
            }
            // Handle positional arguments
            if (result.command.length === 0 && this.commands.has(arg)) {
                // This is a command
                result.command.push(arg);
                // Check for subcommand (level 1)
                const cmd = this.commands.get(arg);
                if (cmd?.subcommands && i + 1 < args.length) {
                    const nextArg = args[i + 1];
                    const subCmd = cmd.subcommands.find(sc => sc.name === nextArg || sc.aliases?.includes(nextArg));
                    if (subCmd) {
                        result.command.push(nextArg);
                        i++;
                        // Check for nested subcommand (level 2)
                        if (subCmd.subcommands && i + 1 < args.length) {
                            const nestedArg = args[i + 1];
                            const nestedCmd = subCmd.subcommands.find(sc => sc.name === nestedArg || sc.aliases?.includes(nestedArg));
                            if (nestedCmd) {
                                result.command.push(nestedArg);
                                i++;
                                // Check for deeply nested subcommand (level 3)
                                if (nestedCmd.subcommands && i + 1 < args.length) {
                                    const deepArg = args[i + 1];
                                    const deepCmd = nestedCmd.subcommands.find(sc => sc.name === deepArg || sc.aliases?.includes(deepArg));
                                    if (deepCmd) {
                                        result.command.push(deepArg);
                                        i++;
                                    }
                                }
                            }
                        }
                    }
                }
            }
            else {
                // Positional argument
                result.positional.push(arg);
                result.flags._.push(arg);
            }
            i++;
        }
        // Apply defaults
        this.applyDefaults(result.flags);
        return result;
    }
    parseFlag(args, index, aliases, booleanFlags) {
        const flags = { _: [] };
        const arg = args[index];
        let nextIndex = index + 1;
        if (arg.startsWith('--')) {
            // Long flag
            const equalIndex = arg.indexOf('=');
            if (equalIndex !== -1) {
                // --flag=value
                const key = arg.slice(2, equalIndex);
                const value = arg.slice(equalIndex + 1);
                this.setFlagSafe(flags, this.normalizeKey(key), this.parseValue(value));
            }
            else if (arg.startsWith('--no-')) {
                // --no-flag (boolean negation) — only accept for declared boolean flags
                // so attackers can't covertly toggle off arbitrary security controls
                // (--no-verify-signature, --no-confirm, etc.) when the underlying flag
                // doesn't exist as a boolean option. Unknown --no-X is treated as a
                // string flag passed verbatim, which validation can then reject.
                const key = arg.slice(5);
                const normalizedKey = this.normalizeKey(key);
                if (booleanFlags.has(normalizedKey)) {
                    this.setFlagSafe(flags, normalizedKey, false);
                }
                else {
                    // Record under the prefixed name so it surfaces as unknown rather
                    // than silently downgrading any flag the user happens to spell.
                    this.setFlagSafe(flags, this.normalizeKey('no-' + key), true);
                }
            }
            else {
                const key = arg.slice(2);
                const normalizedKey = this.normalizeKey(key);
                if (booleanFlags.has(normalizedKey)) {
                    this.setFlagSafe(flags, normalizedKey, true);
                }
                else if (nextIndex < args.length && !args[nextIndex].startsWith('-')) {
                    this.setFlagSafe(flags, normalizedKey, this.parseValue(args[nextIndex]));
                    nextIndex++;
                }
                else {
                    this.setFlagSafe(flags, normalizedKey, true);
                }
            }
        }
        else if (arg.startsWith('-')) {
            // Short flag(s)
            const chars = arg.slice(1);
            if (chars.length === 1) {
                // Single short flag
                const key = aliases[chars] || chars;
                const normalizedKey = this.normalizeKey(key);
                if (booleanFlags.has(normalizedKey)) {
                    this.setFlagSafe(flags, normalizedKey, true);
                }
                else if (nextIndex < args.length && !args[nextIndex].startsWith('-')) {
                    this.setFlagSafe(flags, normalizedKey, this.parseValue(args[nextIndex]));
                    nextIndex++;
                }
                else {
                    this.setFlagSafe(flags, normalizedKey, true);
                }
            }
            else {
                // Multiple short flags combined (e.g., -abc)
                for (const char of chars) {
                    const key = aliases[char] || char;
                    this.setFlagSafe(flags, this.normalizeKey(key), true);
                }
            }
        }
        return { flags, nextIndex };
    }
    parseValue(value) {
        // Boolean
        if (value.toLowerCase() === 'true')
            return true;
        if (value.toLowerCase() === 'false')
            return false;
        // Number — only coerce if the string is unambiguously a canonical number.
        // The previous code coerced any numeric-looking string, which silently
        // dropped leading zeros ("00042" → 42), mangled IDs/tokens above
        // Number.MAX_SAFE_INTEGER, and could cause tenant/identity mix-ups when
        // downstream consumers strict-equal-compared against stored strings.
        if (value.trim() !== '' && /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value)) {
            const num = Number(value);
            if (Number.isFinite(num) && Number.isSafeInteger(num) || (!Number.isInteger(num) && Number.isFinite(num))) {
                return num;
            }
        }
        // String
        return value;
    }
    normalizeKey(key) {
        // Convert kebab-case to camelCase
        return key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    }
    buildAliases() {
        const aliases = {};
        for (const opt of this.globalOptions) {
            if (opt.short) {
                aliases[opt.short] = opt.name;
            }
        }
        // Add aliases from all commands and subcommands
        for (const cmd of this.commands.values()) {
            if (cmd.options) {
                for (const opt of cmd.options) {
                    if (opt.short) {
                        aliases[opt.short] = opt.name;
                    }
                }
            }
            // Also include subcommands' options
            if (cmd.subcommands) {
                for (const sub of cmd.subcommands) {
                    if (sub.options) {
                        for (const opt of sub.options) {
                            if (opt.short) {
                                aliases[opt.short] = opt.name;
                            }
                        }
                    }
                }
            }
        }
        return { ...aliases, ...this.options.aliases };
    }
    /**
     * Build aliases scoped to a specific command/subcommand.
     * The resolved command's short flags take priority over global ones,
     * fixing collisions where multiple subcommands use the same short flag (e.g. -t).
     */
    buildScopedAliases(resolvedCmd) {
        // Start with global aliases as base
        const aliases = this.buildAliases();
        // Override with the resolved command's own options (these take priority)
        if (resolvedCmd?.options) {
            for (const opt of resolvedCmd.options) {
                if (opt.short) {
                    aliases[opt.short] = opt.name;
                }
            }
        }
        return aliases;
    }
    /**
     * Get boolean flags scoped to a specific command/subcommand.
     */
    getScopedBooleanFlags(resolvedCmd) {
        const flags = this.getBooleanFlags();
        if (resolvedCmd?.options) {
            for (const opt of resolvedCmd.options) {
                if (opt.type === 'boolean') {
                    flags.add(this.normalizeKey(opt.name));
                }
            }
        }
        return flags;
    }
    getBooleanFlags() {
        const flags = new Set();
        for (const opt of this.globalOptions) {
            if (opt.type === 'boolean') {
                flags.add(this.normalizeKey(opt.name));
            }
        }
        // Add boolean flags from all commands and subcommands
        for (const cmd of this.commands.values()) {
            if (cmd.options) {
                for (const opt of cmd.options) {
                    if (opt.type === 'boolean') {
                        flags.add(this.normalizeKey(opt.name));
                    }
                }
            }
            // Also include subcommands' boolean flags
            if (cmd.subcommands) {
                for (const sub of cmd.subcommands) {
                    if (sub.options) {
                        for (const opt of sub.options) {
                            if (opt.type === 'boolean') {
                                flags.add(this.normalizeKey(opt.name));
                            }
                        }
                    }
                }
            }
        }
        if (this.options.booleanFlags) {
            for (const flag of this.options.booleanFlags) {
                flags.add(this.normalizeKey(flag));
            }
        }
        return flags;
    }
    applyDefaults(flags) {
        // Apply global option defaults
        for (const opt of this.globalOptions) {
            const key = this.normalizeKey(opt.name);
            if (flags[key] === undefined && opt.default !== undefined) {
                flags[key] = opt.default;
            }
        }
        // Apply custom defaults
        if (this.options.defaults) {
            for (const [key, value] of Object.entries(this.options.defaults)) {
                const normalizedKey = this.normalizeKey(key);
                if (flags[normalizedKey] === undefined) {
                    flags[normalizedKey] = value;
                }
            }
        }
    }
    validateFlags(flags, command) {
        const errors = [];
        const allOptions = [...this.globalOptions];
        if (command?.options) {
            allOptions.push(...command.options);
        }
        // Check required flags
        for (const opt of allOptions) {
            const key = this.normalizeKey(opt.name);
            if (opt.required && (flags[key] === undefined || flags[key] === '')) {
                errors.push(`Required option missing: --${opt.name}`);
            }
            // Check choices
            if (opt.choices && flags[key] !== undefined) {
                const value = String(flags[key]);
                if (!opt.choices.includes(value)) {
                    errors.push(`Invalid value for --${opt.name}: ${value}. Must be one of: ${opt.choices.join(', ')}`);
                }
            }
            // Run custom validator
            if (opt.validate && flags[key] !== undefined) {
                const result = opt.validate(flags[key]);
                if (result !== true) {
                    errors.push(typeof result === 'string' ? result : `Invalid value for --${opt.name}`);
                }
            }
        }
        // Check for unknown flags if not allowed
        if (!this.options.allowUnknownFlags) {
            const knownFlags = new Set(allOptions.map(opt => this.normalizeKey(opt.name)));
            knownFlags.add('_'); // Positional args
            for (const key of Object.keys(flags)) {
                if (!knownFlags.has(key) && key !== '_') {
                    errors.push(`Unknown option: --${key}`);
                }
            }
        }
        return errors;
    }
    getGlobalOptions() {
        return [...this.globalOptions];
    }
}
// Export singleton parser instance
export const commandParser = new CommandParser({ allowUnknownFlags: true });
//# sourceMappingURL=parser.js.map