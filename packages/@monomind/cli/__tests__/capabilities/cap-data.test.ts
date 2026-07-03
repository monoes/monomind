import { describe, it, expect } from 'vitest';
import { dataCapability } from '../../src/capabilities/cap-data.js';
import type { FileEntry } from '../../src/capabilities/types.js';
import path from 'path';

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'data');

describe('dataCapability', () => {
  it('has name "data"', () => {
    expect(dataCapability.name).toBe('data');
  });

  it('indexes CSV files with schema detection', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.csv',
        absolutePath: path.join(FIXTURES, 'sample.csv'),
        extension: '.csv',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];

    await dataCapability.activate(FIXTURES);
    const result = await dataCapability.index(files);
    expect(result.indexed).toBe(1);
  });

  it('search finds data by column name', async () => {
    const files: FileEntry[] = [
      {
        path: 'sample.csv',
        absolutePath: path.join(FIXTURES, 'sample.csv'),
        extension: '.csv',
        size: 100,
        modified: new Date(),
        created: new Date(),
      },
    ];

    await dataCapability.activate(FIXTURES);
    await dataCapability.index(files);
    const results = await dataCapability.search!('city', 5);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].type).toBe('data');
  });
});
