import { describe, it, expect } from 'vitest';
import { listReposTool } from '../../mcp-tools/list-repos.js';

describe('listReposTool', () => {
  it('has correct name', () => {
    expect(listReposTool.name).toBe('monograph_list_repos');
  });

  it('has description', () => {
    expect(typeof listReposTool.description).toBe('string');
    expect(listReposTool.description.length).toBeGreaterThan(5);
  });

  it('has inputSchema', () => {
    expect(listReposTool.inputSchema).toBeDefined();
    expect(listReposTool.inputSchema.type).toBe('object');
  });

  it('handler returns repos array', async () => {
    const result = await listReposTool.handler({});
    expect(result).toHaveProperty('repos');
    expect(Array.isArray(result.repos)).toBe(true);
  });
});
