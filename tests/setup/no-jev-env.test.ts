import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('test environment', () => {
  it('carries no Jev provider configuration from the developer shell', () => {
    for (const name of [
      'MONOMIND_JEV_URL',
      'MONOMIND_JEV_API_KEY',
      'TYPESAFE_API_KEY',
      'MONOMIND_JEV_HOSTED',
    ])
      expect(process.env[name], name).toBeUndefined();
  });

  it('points the named-provider lookup at a file that does not exist', () => {
    const file = process.env.MONOMIND_DECISION_PROVIDERS_FILE;
    expect(file).toBeTruthy();
    expect(existsSync(file as string)).toBe(false);
  });
});
