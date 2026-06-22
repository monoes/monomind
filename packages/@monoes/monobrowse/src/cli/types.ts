export interface CommandContext {
  args: string[];
  flags: ParsedFlags;
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
