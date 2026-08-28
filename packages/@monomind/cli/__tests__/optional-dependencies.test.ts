import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageJsonPath = path.join(import.meta.dirname, '..', 'package.json');

describe('optional document extractors', () => {
  it('does not make SheetJS a required download', () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.xlsx).toBeUndefined();
  });
});
