import { openDb } from '../storage/db.js';
import { checkStaleness } from '../staleness/git-staleness.js';
export async function getMonographStaleness(repoPath) {
    const { join } = await import('path');
    const dbPath = join(repoPath, '.monomind', 'monograph.db');
    const db = openDb(dbPath);
    try {
        return checkStaleness(db, repoPath);
    }
    finally {
        db.close();
    }
}
//# sourceMappingURL=staleness.js.map