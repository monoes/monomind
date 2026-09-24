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
});
