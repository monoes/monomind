/**
 * CLI Interactive Prompt System
 * Modern interactive prompts for user input
 */
import type { SelectPromptOptions, SelectOption, ConfirmPromptOptions, InputPromptOptions, MultiSelectPromptOptions } from './types.js';
import { OutputFormatter } from './output.js';
declare class PromptManager {
    private rl;
    private formatter;
    constructor(formatter?: OutputFormatter);
    private createInterface;
    private close;
    private question;
    select<T = string>(options: SelectPromptOptions<T>): Promise<T>;
    confirm(options: ConfirmPromptOptions): Promise<boolean>;
    input(options: InputPromptOptions): Promise<string>;
    private inputMasked;
    multiSelect<T = string>(options: MultiSelectPromptOptions<T>): Promise<T[]>;
    text(message: string, placeholder?: string): Promise<string>;
    number(message: string, options?: {
        default?: number;
        min?: number;
        max?: number;
    }): Promise<number>;
    autocomplete<T = string>(message: string, choices: SelectOption<T>[], options?: {
        limit?: number;
    }): Promise<T>;
}
export declare const promptManager: PromptManager;
export declare const select: <T = string>(options: SelectPromptOptions<T>) => Promise<T>;
export declare const confirm: (options: ConfirmPromptOptions) => Promise<boolean>;
export declare const input: (options: InputPromptOptions) => Promise<string>;
export declare const multiSelect: <T = string>(options: MultiSelectPromptOptions<T>) => Promise<T[]>;
export declare const text: (message: string, placeholder?: string) => Promise<string>;
export declare const number: (message: string, options?: {
    default?: number;
    min?: number;
    max?: number;
}) => Promise<number>;
export declare const autocomplete: <T = string>(message: string, choices: SelectOption<T>[], options?: {
    limit?: number;
}) => Promise<T>;
export {};
//# sourceMappingURL=prompt.d.ts.map