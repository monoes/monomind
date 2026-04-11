import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { ExtractionResult } from './types.js';

export class FileCache {
  private cacheDir: string;

  constructor(outputDir: string) {
    this.cacheDir = join(outputDir, 'cache');
    mkdirSync(this.cacheDir, { recursive: true });
  }

  key(filePath: string, content: string): string {
    return createHash('sha256')
      .update(filePath + content)
      .digest('hex');
  }

  get(key: string): ExtractionResult | null {
    const p = join(this.cacheDir, `${key}.json`);
    if (!existsSync(p)) return null;
    try {
      return JSON.parse(readFileSync(p, 'utf-8')) as ExtractionResult;
    } catch {
      return null;
    }
  }

  set(key: string, result: ExtractionResult): void {
    const p = join(this.cacheDir, `${key}.json`);
    writeFileSync(p, JSON.stringify(result), 'utf-8');
  }

  has(key: string): boolean {
    return existsSync(join(this.cacheDir, `${key}.json`));
  }
}
