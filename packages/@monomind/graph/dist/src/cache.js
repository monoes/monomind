import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
export class FileCache {
    cacheDir;
    constructor(outputDir) {
        this.cacheDir = join(outputDir, 'cache');
        mkdirSync(this.cacheDir, { recursive: true });
    }
    /** Strip YAML frontmatter (--- blocks) before hashing so metadata-only changes don't bust the cache. */
    stripFrontmatter(content) {
        if (!content.startsWith('---'))
            return content;
        const end = content.indexOf('\n---', 3);
        return end === -1 ? content : content.slice(end + 4);
    }
    key(filePath, content) {
        return createHash('sha256')
            .update(filePath + this.stripFrontmatter(content))
            .digest('hex');
    }
    get(key) {
        const p = join(this.cacheDir, `${key}.json`);
        if (!existsSync(p))
            return null;
        try {
            return JSON.parse(readFileSync(p, 'utf-8'));
        }
        catch {
            return null;
        }
    }
    set(key, result) {
        const p = join(this.cacheDir, `${key}.json`);
        const tmp = `${p}.tmp`;
        writeFileSync(tmp, JSON.stringify(result), 'utf-8');
        renameSync(tmp, p);
    }
    has(key) {
        return existsSync(join(this.cacheDir, `${key}.json`));
    }
}
//# sourceMappingURL=cache.js.map