import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
export class FileCache {
    cacheDir;
    constructor(outputDir) {
        this.cacheDir = join(outputDir, 'cache');
        mkdirSync(this.cacheDir, { recursive: true });
    }
    key(filePath, content) {
        return createHash('sha256')
            .update(filePath + content)
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
        writeFileSync(p, JSON.stringify(result), 'utf-8');
    }
    has(key) {
        return existsSync(join(this.cacheDir, `${key}.json`));
    }
}
//# sourceMappingURL=cache.js.map