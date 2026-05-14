/**
 * CLI Output Formatter
 * Advanced output formatting with tables, progress bars, and colors
 */
import type { TableOptions, ProgressOptions, SpinnerOptions } from './types.js';
declare const COLORS: {
    readonly reset: "\u001B[0m";
    readonly bold: "\u001B[1m";
    readonly dim: "\u001B[2m";
    readonly italic: "\u001B[3m";
    readonly underline: "\u001B[4m";
    readonly black: "\u001B[30m";
    readonly red: "\u001B[31m";
    readonly green: "\u001B[32m";
    readonly yellow: "\u001B[33m";
    readonly blue: "\u001B[34m";
    readonly magenta: "\u001B[35m";
    readonly cyan: "\u001B[36m";
    readonly white: "\u001B[37m";
    readonly gray: "\u001B[90m";
    readonly brightRed: "\u001B[91m";
    readonly brightGreen: "\u001B[92m";
    readonly brightYellow: "\u001B[93m";
    readonly brightBlue: "\u001B[94m";
    readonly brightMagenta: "\u001B[95m";
    readonly brightCyan: "\u001B[96m";
    readonly brightWhite: "\u001B[97m";
    readonly bgBlack: "\u001B[40m";
    readonly bgRed: "\u001B[41m";
    readonly bgGreen: "\u001B[42m";
    readonly bgYellow: "\u001B[43m";
    readonly bgBlue: "\u001B[44m";
    readonly bgMagenta: "\u001B[45m";
    readonly bgCyan: "\u001B[46m";
    readonly bgWhite: "\u001B[47m";
};
type ColorName = keyof typeof COLORS;
export type VerbosityLevel = 'quiet' | 'normal' | 'verbose' | 'debug';
export declare class OutputFormatter {
    private colorEnabled;
    private outputStream;
    private errorStream;
    private verbosity;
    constructor(options?: {
        color?: boolean;
        verbosity?: VerbosityLevel;
    });
    /**
     * Set verbosity level
     * - quiet: Only errors and direct results
     * - normal: Errors, warnings, info, and results
     * - verbose: All of normal + debug messages
     * - debug: All output including trace
     */
    setVerbosity(level: VerbosityLevel): void;
    getVerbosity(): VerbosityLevel;
    isQuiet(): boolean;
    isVerbose(): boolean;
    isDebug(): boolean;
    private supportsColor;
    color(text: string, ...colors: ColorName[]): string;
    bold(text: string): string;
    dim(text: string): string;
    success(text: string): string;
    error(text: string): string;
    warning(text: string): string;
    info(text: string): string;
    highlight(text: string): string;
    write(text: string): void;
    writeln(text?: string): void;
    writeError(text: string): void;
    writeErrorln(text?: string): void;
    printSuccess(message: string): void;
    printError(message: string, details?: string): void;
    printWarning(message: string): void;
    printInfo(message: string): void;
    printDebug(message: string): void;
    printTrace(message: string): void;
    table(options: TableOptions): string;
    printTable(options: TableOptions): void;
    private calculateColumnWidths;
    private createBorderLine;
    private alignText;
    private truncate;
    private stripAnsi;
    createProgress(options: ProgressOptions): Progress;
    progressBar(current: number, total: number, width?: number): string;
    createSpinner(options: SpinnerOptions): Spinner;
    json(data: unknown, pretty?: boolean): string;
    printJson(data: unknown, pretty?: boolean): void;
    list(items: string[], bullet?: string): string;
    printList(items: string[], bullet?: string): void;
    numberedList(items: string[]): string;
    printNumberedList(items: string[]): void;
    box(content: string, title?: string): string;
    printBox(content: string, title?: string): void;
    setColorEnabled(enabled: boolean): void;
    isColorEnabled(): boolean;
}
export declare class Progress {
    private current;
    private total;
    private width;
    private startTime;
    private formatter;
    private showPercentage;
    private showETA;
    private lastRender;
    constructor(formatter: OutputFormatter, options: ProgressOptions);
    update(current: number): void;
    increment(amount?: number): void;
    render(): void;
    finish(): void;
    private formatTime;
}
export declare class Spinner {
    private formatter;
    private text;
    private frames;
    private interval;
    private frameIndex;
    private static readonly SPINNERS;
    constructor(formatter: OutputFormatter, options: SpinnerOptions);
    start(): void;
    stop(message?: string): void;
    succeed(message?: string): void;
    fail(message?: string): void;
    private render;
    setText(text: string): void;
}
export declare const output: OutputFormatter;
export {};
//# sourceMappingURL=output.d.ts.map