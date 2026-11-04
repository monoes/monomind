import { describe, expect, it } from 'vitest';
import { HELP_SUMMARIES } from '../commands/help-summaries.js';
import { getCommandsByCategory } from '../commands/index.js';

// `monomind --help` renders from HELP_SUMMARIES so it never imports the 40
// lazy command modules. This keeps that table honest against the real commands.
describe('HELP_SUMMARIES', () => {
  it('matches the name and description of every visible command, per category', async () => {
    const real = await getCommandsByCategory();
    for (const category of Object.keys(real) as (keyof typeof real)[]) {
      const expected = real[category]
        .filter((cmd) => !cmd.hidden)
        .map(({ name, description }) => ({ name, description }));
      expect(HELP_SUMMARIES[category], category).toEqual(expected);
    }
  });
});
