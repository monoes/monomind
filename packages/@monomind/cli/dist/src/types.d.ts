/**
 * CLI Type Definitions
 * Modernized type system for the Monomind CLI
 */
export interface CommandContext {
    args: string[];
    flags: ParsedFlags;
    config?: MonomindConfig;
    cwd: string;
    interactive: boolean;
}
export interface ParsedFlags {
    [key: string]: string | boolean | number | string[];
    _: string[];
}
export interface Command {
    name: string;
    description: string;
    aliases?: string[];
    subcommands?: Command[];
    options?: CommandOption[];
    examples?: CommandExample[];
    action?: CommandAction;
    hidden?: boolean;
}
export interface CommandOption {
    name: string;
    short?: string;
    description: string;
    type: 'string' | 'boolean' | 'number' | 'array';
    default?: unknown;
    required?: boolean;
    choices?: string[];
    validate?: (value: unknown) => boolean | string;
}
export interface CommandExample {
    command: string;
    description: string;
}
export type CommandAction = (ctx: CommandContext) => Promise<CommandResult | void>;
export interface CommandResult {
    success: boolean;
    message?: string;
    data?: unknown;
    exitCode?: number;
}
export interface MonomindConfig {
    version: string;
    projectRoot: string;
    agents: AgentConfig;
    swarm: SwarmConfig;
    memory: MemoryConfig;
    mcp: MCPConfig;
    cli: CLIPreferences;
    hooks: HooksConfig;
    neural?: NeuralConfig;
}
export interface NeuralConfig {
    /** Enable pattern learning (default: true) */
    enabled?: boolean;
    /** Force pure-JS fallback, skip all native @monoes packages (default: false) */
    disableNative?: boolean;
}
export interface AgentConfig {
    defaultType: string;
    autoSpawn: boolean;
    maxConcurrent: number;
    timeout: number;
    providers: ProviderConfig[];
}
export interface ProviderConfig {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    priority: number;
    enabled: boolean;
}
export interface SwarmConfig {
    topology: 'hierarchical' | 'mesh' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh';
    maxAgents: number;
    autoScale: boolean;
    coordinationStrategy: 'consensus' | 'leader' | 'distributed';
    healthCheckInterval: number;
}
export interface MemoryConfig {
    backend: 'agentdb' | 'sqlite' | 'memory' | 'hybrid';
    persistPath: string;
    cacheSize: number;
    enableHNSW: boolean;
    vectorDimension: number;
}
export interface MCPConfig {
    serverHost: string;
    serverPort: number;
    autoStart: boolean;
    transportType: 'stdio' | 'http' | 'websocket';
    tools: string[];
}
export interface CLIPreferences {
    colorOutput: boolean;
    interactive: boolean;
    verbosity: 'quiet' | 'normal' | 'verbose' | 'debug';
    outputFormat: 'text' | 'json' | 'table';
    progressStyle: 'bar' | 'spinner' | 'dots' | 'none';
}
export interface HooksConfig {
    enabled: boolean;
    autoExecute: boolean;
    hooks: HookDefinition[];
}
export interface HookDefinition {
    name: string;
    event: string;
    handler: string;
    priority: number;
    enabled: boolean;
}
export interface TableColumn {
    key: string;
    header: string;
    width?: number;
    align?: 'left' | 'center' | 'right';
    format?: (value: unknown) => string;
}
export interface TableOptions {
    columns: TableColumn[];
    data: Record<string, unknown>[];
    border?: boolean;
    header?: boolean;
    padding?: number;
    maxWidth?: number;
}
export interface ProgressOptions {
    total: number;
    current?: number;
    width?: number;
    format?: string;
    showPercentage?: boolean;
    showETA?: boolean;
    showSpeed?: boolean;
}
export interface SpinnerOptions {
    text: string;
    spinner?: 'dots' | 'line' | 'arc' | 'circle' | 'arrows';
    color?: string;
}
export interface SelectOption<T = string> {
    value: T;
    label: string;
    hint?: string;
    disabled?: boolean;
    /** For multiselect: whether this option is selected by default */
    selected?: boolean;
}
export interface SelectPromptOptions<T = string> {
    message: string;
    options: SelectOption<T>[];
    default?: T;
    searchable?: boolean;
    pageSize?: number;
}
export interface ConfirmPromptOptions {
    message: string;
    default?: boolean;
    active?: string;
    inactive?: string;
}
export interface InputPromptOptions {
    message: string;
    default?: string;
    placeholder?: string;
    validate?: (value: string) => boolean | string;
    mask?: boolean;
}
export interface MultiSelectPromptOptions<T = string> {
    message: string;
    options: SelectOption<T>[];
    default?: T[];
    required?: boolean;
    min?: number;
    max?: number;
}
export declare class CLIError extends Error {
    code: string;
    exitCode: number;
    details?: unknown | undefined;
    constructor(message: string, code: string, exitCode?: number, details?: unknown | undefined);
}
//# sourceMappingURL=types.d.ts.map