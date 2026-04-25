import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import type { ExtractionResult } from './types.js';

export class FileCache {
  private cacheDir: string;

  constructor(outputDir: string) {
    this.cacheDir = join(outputDir, 'cache');
    mkdirSync(this.cacheDir, { recursive: true });
  }

  /** Strip YAML frontmatter (--- blocks) before hashing so metadata-only changes don't bust the cache. */
  private stripFrontmatter(content: string): string {
    if (!content.startsWith('---')) return content;
    const end = content.indexOf('\n---', 3);
    return end === -1 ? content : content.slice(end + 4);
  }

  key(filePath: string, content: string): string {
    return createHash('sha256')
      .update(filePath + this.stripFrontmatter(content))
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
    const tmp = `${p}.tmp`;
    writeFileSync(tmp, JSON.stringify(result), 'utf-8');
    renameSync(tmp, p);
  }

  has(key: string): boolean {
    return existsSync(join(this.cacheDir, `${key}.json`));
  }
}
