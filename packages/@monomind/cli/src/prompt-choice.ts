/**
 * CLI Interactive Prompt System — choice-list prompts (select, multiSelect, autocomplete)
 * Split out of prompt.ts (file-size sweep). Pure move: these methods never
 * used the PromptManager's `question`/`inputMasked` machinery, only
 * `formatter`/`createInterface`/`close`, so they move verbatim as functions
 * taking the PromptManager instance (`self`) in place of `this`.
 */

import type { PromptManager } from './prompt.js';
import type { MultiSelectPromptOptions, SelectOption, SelectPromptOptions } from './types.js';

// ============================================
// Select Prompt
// ============================================

export async function selectPrompt<T = string>(
  self: PromptManager,
  options: SelectPromptOptions<T>,
): Promise<T> {
  const { message, options: choices, default: defaultValue, pageSize = 10 } = options;

  self.formatter.writeln();
  self.formatter.writeln(self.formatter.bold(`? ${message}`));
  self.formatter.writeln(self.formatter.dim('  (Use arrow keys to navigate, enter to select)'));
  self.formatter.writeln();

  // Find default index
  let selectedIndex = 0;
  if (defaultValue !== undefined) {
    const idx = choices.findIndex((c) => c.value === defaultValue);
    if (idx !== -1) selectedIndex = idx;
  }

  // Display options
  const displayChoices = (currentIndex: number, startIndex: number = 0) => {
    // Move cursor up to overwrite
    if (startIndex > 0 || currentIndex > 0) {
      process.stdout.write(`\x1b[${Math.min(choices.length, pageSize)}A`);
    }

    const endIndex = Math.min(startIndex + pageSize, choices.length);
    for (let i = startIndex; i < endIndex; i++) {
      const choice = choices[i];
      const isSelected = i === currentIndex;
      const prefix = isSelected ? self.formatter.info('>') : ' ';
      const label = isSelected ? self.formatter.highlight(choice.label) : choice.label;
      const hint = choice.hint ? self.formatter.dim(` - ${choice.hint}`) : '';
      const disabled = choice.disabled ? self.formatter.dim(' (disabled)') : '';

      self.formatter.writeln(`  ${prefix} ${label}${hint}${disabled}`);
    }
  };

  // Initial display
  displayChoices(selectedIndex);

  return new Promise<T>((resolve, reject) => {
    self.createInterface();

    // Enable raw mode for arrow key detection
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const handleKeypress = (key: Buffer) => {
      const keyStr = key.toString();

      // Arrow keys
      if (keyStr === '\x1b[A') {
        // Up
        do {
          selectedIndex = (selectedIndex - 1 + choices.length) % choices.length;
        } while (choices[selectedIndex].disabled && selectedIndex !== 0);
        displayChoices(selectedIndex);
      } else if (keyStr === '\x1b[B') {
        // Down
        do {
          selectedIndex = (selectedIndex + 1) % choices.length;
        } while (choices[selectedIndex].disabled && selectedIndex !== choices.length - 1);
        displayChoices(selectedIndex);
      } else if (keyStr === '\r' || keyStr === '\n') {
        // Enter
        cleanup();
        const selected = choices[selectedIndex];
        if (!selected.disabled) {
          self.formatter.writeln();
          self.formatter.writeln(self.formatter.success(`Selected: ${selected.label}`));
          resolve(selected.value);
        }
      } else if (keyStr === '\x03') {
        // Ctrl+C
        cleanup();
        reject(new Error('User cancelled'));
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      self.close();
    };

    process.stdin.on('data', handleKeypress);
  });
}

// ============================================
// Multi-Select Prompt
// ============================================

export async function multiSelectPrompt<T = string>(
  self: PromptManager,
  options: MultiSelectPromptOptions<T>,
): Promise<T[]> {
  const {
    message,
    options: choices,
    default: defaultValues = [],
    required = false,
    min,
    max,
  } = options;

  self.formatter.writeln();
  self.formatter.writeln(self.formatter.bold(`? ${message}`));
  self.formatter.writeln(
    self.formatter.dim('  (Use arrow keys to navigate, space to select, enter to confirm)'),
  );
  self.formatter.writeln();

  // Initialize selection state
  const selected = new Set<number>();
  for (let i = 0; i < choices.length; i++) {
    // Check both default array and individual selected property
    if (defaultValues.includes(choices[i].value) || choices[i].selected) {
      selected.add(i);
    }
  }

  let currentIndex = 0;

  // Display options
  const displayChoices = () => {
    // Move cursor up to overwrite
    process.stdout.write(`\x1b[${choices.length}A`);

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const isCurrentRow = i === currentIndex;
      const isSelected = selected.has(i);

      const cursor = isCurrentRow ? self.formatter.info('>') : ' ';
      const checkbox = isSelected ? self.formatter.success('[x]') : self.formatter.dim('[ ]');
      const label = isCurrentRow ? self.formatter.highlight(choice.label) : choice.label;
      const hint = choice.hint ? self.formatter.dim(` - ${choice.hint}`) : '';
      const disabled = choice.disabled ? self.formatter.dim(' (disabled)') : '';

      self.formatter.writeln(`  ${cursor} ${checkbox} ${label}${hint}${disabled}`);
    }
  };

  // Initial display
  for (let i = 0; i < choices.length; i++) {
    self.formatter.writeln('');
  }
  displayChoices();

  return new Promise<T[]>((resolve, reject) => {
    self.createInterface();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const handleKeypress = (key: Buffer) => {
      const keyStr = key.toString();

      if (keyStr === '\x1b[A') {
        // Up
        currentIndex = (currentIndex - 1 + choices.length) % choices.length;
        displayChoices();
      } else if (keyStr === '\x1b[B') {
        // Down
        currentIndex = (currentIndex + 1) % choices.length;
        displayChoices();
      } else if (keyStr === ' ') {
        // Space
        if (!choices[currentIndex].disabled) {
          if (selected.has(currentIndex)) {
            selected.delete(currentIndex);
          } else {
            // Check max limit
            if (!max || selected.size < max) {
              selected.add(currentIndex);
            }
          }
          displayChoices();
        }
      } else if (keyStr === '\r' || keyStr === '\n') {
        // Enter
        // Validate selection
        if (required && selected.size === 0) {
          self.formatter.writeln(self.formatter.error('  At least one option must be selected'));
          return;
        }
        if (min && selected.size < min) {
          self.formatter.writeln(
            self.formatter.error(`  At least ${min} options must be selected`),
          );
          return;
        }

        cleanup();
        const selectedValues = Array.from(selected).map((i) => choices[i].value);
        const selectedLabels = Array.from(selected).map((i) => choices[i].label);
        self.formatter.writeln();
        self.formatter.writeln(self.formatter.success(`Selected: ${selectedLabels.join(', ')}`));
        resolve(selectedValues);
      } else if (keyStr === '\x03') {
        // Ctrl+C
        cleanup();
        reject(new Error('User cancelled'));
      } else if (keyStr === 'a') {
        // Select all
        if (!max || choices.length <= max) {
          for (let i = 0; i < choices.length; i++) {
            if (!choices[i].disabled) {
              selected.add(i);
            }
          }
          displayChoices();
        }
      } else if (keyStr === 'n') {
        // Select none
        selected.clear();
        displayChoices();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      self.close();
    };

    process.stdin.on('data', handleKeypress);
  });
}

// ============================================
// Autocomplete Prompt
// ============================================

export async function autocompletePrompt<T = string>(
  self: PromptManager,
  message: string,
  choices: SelectOption<T>[],
  options: { limit?: number } = {},
): Promise<T> {
  const { limit = 10 } = options;

  self.formatter.writeln();
  self.formatter.writeln(self.formatter.bold(`? ${message}`));
  self.formatter.writeln(self.formatter.dim('  (Type to filter, arrow keys to navigate)'));

  let query = '';
  let selectedIndex = 0;
  let filteredChoices = choices.slice(0, limit);

  const filterChoices = (q: string): SelectOption<T>[] => {
    if (q === '') return choices.slice(0, limit);

    const normalized = q.toLowerCase();
    return choices.filter((c) => c.label.toLowerCase().includes(normalized)).slice(0, limit);
  };

  const displayChoices = () => {
    // Clear previous output
    process.stdout.write(`\x1b[${filteredChoices.length + 1}A`);
    process.stdout.write('\x1b[J');

    // Show input
    self.formatter.writeln(`  ${self.formatter.dim('>')} ${query}`);

    // Show filtered options
    for (let i = 0; i < filteredChoices.length; i++) {
      const choice = filteredChoices[i];
      const isSelected = i === selectedIndex;
      const prefix = isSelected ? self.formatter.info('>') : ' ';
      const label = isSelected ? self.formatter.highlight(choice.label) : choice.label;
      self.formatter.writeln(`  ${prefix} ${label}`);
    }
  };

  // Initial display
  self.formatter.writeln('');
  for (let i = 0; i < limit; i++) {
    self.formatter.writeln('');
  }
  displayChoices();

  return new Promise<T>((resolve, reject) => {
    self.createInterface();

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const handleKeypress = (key: Buffer) => {
      const keyStr = key.toString();

      if (keyStr === '\x1b[A') {
        // Up
        selectedIndex = Math.max(0, selectedIndex - 1);
        displayChoices();
      } else if (keyStr === '\x1b[B') {
        // Down
        selectedIndex = Math.min(filteredChoices.length - 1, selectedIndex + 1);
        displayChoices();
      } else if (keyStr === '\r' || keyStr === '\n') {
        // Enter
        if (filteredChoices.length > 0) {
          cleanup();
          const selected = filteredChoices[selectedIndex];
          self.formatter.writeln();
          self.formatter.writeln(self.formatter.success(`Selected: ${selected.label}`));
          resolve(selected.value);
        }
      } else if (keyStr === '\x7f' || keyStr === '\x08') {
        // Backspace
        query = query.slice(0, -1);
        filteredChoices = filterChoices(query);
        selectedIndex = 0;
        displayChoices();
      } else if (keyStr === '\x03') {
        // Ctrl+C
        cleanup();
        reject(new Error('User cancelled'));
      } else if (keyStr.charCodeAt(0) >= 32 && keyStr.charCodeAt(0) < 127) {
        // Printable character
        query += keyStr;
        filteredChoices = filterChoices(query);
        selectedIndex = 0;
        displayChoices();
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', handleKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      self.close();
    };

    process.stdin.on('data', handleKeypress);
  });
}
