/**
 * CLI Interactive Prompt System
 * Modern interactive prompts for user input
 */

import * as readline from 'node:readline';
import { type OutputFormatter, output } from './output.js';
import { autocompletePrompt, multiSelectPrompt, selectPrompt } from './prompt-choice.js';
import type {
  ConfirmPromptOptions,
  InputPromptOptions,
  MultiSelectPromptOptions,
  SelectOption,
  SelectPromptOptions,
} from './types.js';

// ============================================
// Core Prompt Infrastructure
// ============================================

// `formatter`/`createInterface`/`close` are not `private`: prompt-choice.ts's
// select/multiSelect/autocomplete (split out in the file-size sweep) take a
// PromptManager instance and use these members in place of `this`.
export class PromptManager {
  private rl: readline.Interface | null = null;
  formatter: OutputFormatter;

  constructor(formatter: OutputFormatter = output) {
    this.formatter = formatter;
  }

  createInterface(): readline.Interface {
    if (!this.rl) {
      this.rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: true,
      });

      // Handle cleanup on exit
      this.rl.on('close', () => {
        this.rl = null;
      });
    }
    return this.rl;
  }

  close(): void {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }

  private async question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = this.createInterface();
      let answered = false;
      // On EOF (Ctrl-D) readline emits 'close' but never invokes the
      // rl.question callback below, so without this the promise would only
      // ever resolve via some external timeout — a crashed CLI would look
      // hung for however long that takes instead of exiting immediately.
      // Resolving '' here lets every caller's own empty-input handling
      // (e.g. confirm()'s default-on-empty) apply immediately on EOF too.
      const onClose = () => {
        if (!answered) resolve('');
      };
      rl.once('close', onClose);
      rl.question(prompt, (answer) => {
        answered = true;
        rl.removeListener('close', onClose);
        resolve(answer);
      });
    });
  }

  // ============================================
  // Select Prompt
  // ============================================

  async select<T = string>(options: SelectPromptOptions<T>): Promise<T> {
    return selectPrompt(this, options);
  }

  // ============================================
  // Confirm Prompt
  // ============================================

  async confirm(options: ConfirmPromptOptions): Promise<boolean> {
    const { message, default: defaultValue = false, active = 'Yes', inactive = 'No' } = options;

    const hint = defaultValue ? `[${active}]` : `[${inactive}]`;

    const prompt = `${this.formatter.bold('?')} ${message} ${this.formatter.dim(hint)} `;

    const answer = await this.question(prompt);
    this.close();

    if (answer === '') {
      return defaultValue;
    }

    const normalized = answer.toLowerCase().trim();

    if (['y', 'yes', 'true', '1'].includes(normalized)) {
      return true;
    }

    if (['n', 'no', 'false', '0'].includes(normalized)) {
      return false;
    }

    return defaultValue;
  }

  // ============================================
  // Input Prompt
  // ============================================

  async input(options: InputPromptOptions): Promise<string> {
    const { message, default: defaultValue, placeholder, validate, mask } = options;

    let prompt = `${this.formatter.bold('?')} ${message}`;

    if (defaultValue) {
      prompt += ` ${this.formatter.dim(`(${defaultValue})`)}`;
    } else if (placeholder) {
      prompt += ` ${this.formatter.dim(placeholder)}`;
    }

    prompt += ': ';

    while (true) {
      let answer: string;

      if (mask) {
        answer = await this.inputMasked(prompt);
      } else {
        answer = await this.question(prompt);
      }

      // Use default if empty
      if (answer === '' && defaultValue !== undefined) {
        answer = defaultValue;
      }

      // Validate
      if (validate) {
        const result = validate(answer);
        if (result !== true) {
          const errorMsg = typeof result === 'string' ? result : 'Invalid input';
          this.formatter.writeln(this.formatter.error(`  ${errorMsg}`));
          continue;
        }
      }

      this.close();
      return answer;
    }
  }

  private async inputMasked(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      this.createInterface();
      let password = '';

      // Don't echo characters
      process.stdout.write(prompt);

      if (process.stdin.isTTY) {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();

      const handleData = (chunk: Buffer) => {
        const char = chunk.toString();

        if (char === '\n' || char === '\r') {
          // Enter pressed
          process.stdin.removeListener('data', handleData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          process.stdout.write('\n');
          resolve(password);
        } else if (char === '\x7f' || char === '\x08') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            process.stdout.write('\b \b');
          }
        } else if (char === '\x03') {
          // Ctrl+C
          process.stdin.removeListener('data', handleData);
          if (process.stdin.isTTY) {
            process.stdin.setRawMode(false);
          }
          resolve('');
        } else if (char.charCodeAt(0) >= 32) {
          // Printable character
          password += char;
          process.stdout.write('*');
        }
      };

      process.stdin.on('data', handleData);
    });
  }

  // ============================================
  // Multi-Select Prompt
  // ============================================

  async multiSelect<T = string>(options: MultiSelectPromptOptions<T>): Promise<T[]> {
    return multiSelectPrompt(this, options);
  }

  // ============================================
  // Text Prompt (Multi-line)
  // ============================================

  async text(message: string, placeholder?: string): Promise<string> {
    this.formatter.writeln();
    this.formatter.writeln(this.formatter.bold(`? ${message}`));
    if (placeholder) {
      this.formatter.writeln(this.formatter.dim(`  ${placeholder}`));
    }
    this.formatter.writeln(this.formatter.dim('  (Enter an empty line to finish)'));
    this.formatter.writeln();

    const lines: string[] = [];

    while (true) {
      const line = await this.question('  > ');
      if (line === '') {
        break;
      }
      lines.push(line);
    }

    this.close();
    return lines.join('\n');
  }

  // ============================================
  // Number Prompt
  // ============================================

  async number(
    message: string,
    options: { default?: number; min?: number; max?: number } = {},
  ): Promise<number> {
    const { default: defaultValue, min, max } = options;

    const validate = (value: string): boolean | string => {
      const num = Number(value);
      if (Number.isNaN(num)) {
        return 'Please enter a valid number';
      }
      if (min !== undefined && num < min) {
        return `Value must be at least ${min}`;
      }
      if (max !== undefined && num > max) {
        return `Value must be at most ${max}`;
      }
      return true;
    };

    const result = await this.input({
      message,
      default: defaultValue?.toString(),
      validate,
    });

    return Number(result);
  }

  // ============================================
  // Autocomplete Prompt
  // ============================================

  async autocomplete<T = string>(
    message: string,
    choices: SelectOption<T>[],
    options: { limit?: number } = {},
  ): Promise<T> {
    return autocompletePrompt(this, message, choices, options);
  }
}

// Export singleton and convenience functions
export const promptManager = new PromptManager();

export const select = <T = string>(options: SelectPromptOptions<T>) =>
  promptManager.select(options);

export const confirm = (options: ConfirmPromptOptions) => promptManager.confirm(options);

export const input = (options: InputPromptOptions) => promptManager.input(options);

export const multiSelect = <T = string>(options: MultiSelectPromptOptions<T>) =>
  promptManager.multiSelect(options);

export const text = (message: string, placeholder?: string) =>
  promptManager.text(message, placeholder);

export const number = (
  message: string,
  options?: { default?: number; min?: number; max?: number },
) => promptManager.number(message, options);

export const autocomplete = <T = string>(
  message: string,
  choices: SelectOption<T>[],
  options?: { limit?: number },
) => promptManager.autocomplete(message, choices, options);
