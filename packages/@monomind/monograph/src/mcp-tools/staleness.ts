import { checkStaleness, type StalenessReport } from '../staleness/git-staleness.js';
import { openDb } from '../storage/db.js';

export async function getMonographStaleness(repoPath: string): Promise<StalenessReport> {
  const { join } = await import('node:path');
  const dbPath = join(repoPath, '.monomind', 'monograph.db');
  const db = openDb(dbPath);
  try {
    return checkStaleness(db, repoPath);
  } finally {
    db.close();
  }
}
