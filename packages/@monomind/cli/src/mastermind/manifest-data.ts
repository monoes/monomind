/** Static Mastermind inventory, deliberately dependency-free for init consumers. */

export interface MastermindSkill {
  name: string;
  description: string;
  aliases: readonly string[];
  source: string;
  references: readonly string[];
}

export const MASTERMIND_SKILLS: readonly MastermindSkill[] = [
  {
    name: 'mastermind',
    description: 'Route a request to the relevant Mastermind workflow.',
    aliases: ['router', 'master'],
    source: 'mastermind',
    references: [
      'references/antigravity-tools.md',
      'references/claude-code-tools.md',
      'references/codex-tools.md',
      'references/copilot-tools.md',
      'references/gemini-tools.md',
      'references/pi-tools.md',
    ],
  },
  {
    name: 'mastermind-plan',
    description: 'Write a detailed implementation plan before changing code.',
    aliases: ['plan'],
    source: 'mastermind-plan',
    references: [],
  },
  {
    name: 'mastermind-review',
    description: 'Review code, content, strategy, or security work.',
    aliases: ['review'],
    source: 'mastermind-review',
    references: [],
  },
  {
    name: 'mastermind-debug',
    description: 'Investigate a failure or unexpected behavior before fixing it.',
    aliases: ['debug'],
    source: 'mastermind-debug',
    references: [],
  },
  {
    name: 'mastermind-research',
    description: 'Research an open question before making a decision.',
    aliases: ['research'],
    source: 'mastermind-research',
    references: [],
  },
  {
    name: 'mastermind-execute',
    description: 'Execute a written implementation plan step by step.',
    aliases: ['execute'],
    source: 'mastermind-execute',
    references: [],
  },
  {
    name: 'mastermind-org',
    description: 'Create, run, inspect, and manage a Mastermind organization.',
    aliases: ['org', 'organization', 'orgs'],
    source: 'mastermind-org',
    references: [],
  },
  {
    name: 'mastermind-memory',
    description: 'Store, retrieve, and maintain persistent organization knowledge.',
    aliases: ['memory'],
    source: 'mastermind-memory',
    references: [],
  },
];
