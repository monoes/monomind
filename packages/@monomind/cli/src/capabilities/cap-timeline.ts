import type { CapabilityModule, DirectoryScan, FileEntry, IndexResult, SearchResult } from './types.js';

interface TimelineEntry {
  path: string;
  dates: { label: string; date: Date }[];
}

const timelineIndex = new Map<string, TimelineEntry>();

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function extractDatesFromFilename(filename: string): Date[] {
  const dates: Date[] = [];

  // Match YYYY-MM-DD or YYYY-MM
  const isoMatch = filename.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (isoMatch) {
    const d = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3] ?? '01'}`);
    if (!isNaN(d.getTime())) dates.push(d);
  }

  // Match month names
  const lower = filename.toLowerCase();
  for (let i = 0; i < MONTH_NAMES.length; i++) {
    if (lower.includes(MONTH_NAMES[i]) || lower.includes(MONTH_SHORT[i])) {
      const yearMatch = filename.match(/(\d{4})/);
      if (yearMatch) {
        dates.push(new Date(parseInt(yearMatch[1]), i, 1));
      }
    }
  }

  return dates;
}

export const timelineCapability: CapabilityModule = {
  name: 'timeline',

  detect(_scan: DirectoryScan): number {
    return 0; // cross-cutting — activated by manager, not by detection
  },

  async activate(_rootDir: string): Promise<void> {
    timelineIndex.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    const errors: string[] = [];

    for (const file of files) {
      const dates: { label: string; date: Date }[] = [];

      dates.push({ label: 'modified', date: file.modified });
      dates.push({ label: 'created', date: file.created });

      const filenameDates = extractDatesFromFilename(file.path);
      for (const d of filenameDates) {
        dates.push({ label: 'filename', date: d });
      }

      timelineIndex.set(file.path, { path: file.path, dates });
      indexed++;
    }

    return { indexed, skipped: 0, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    // Parse date hints from query
    let targetMonth = -1;
    let targetYear = -1;

    for (let i = 0; i < MONTH_NAMES.length; i++) {
      if (queryLower.includes(MONTH_NAMES[i]) || queryLower.includes(MONTH_SHORT[i])) {
        targetMonth = i;
        break;
      }
    }

    const yearMatch = query.match(/(\d{4})/);
    if (yearMatch) targetYear = parseInt(yearMatch[1]);

    if (targetMonth === -1 && targetYear === -1) return [];

    for (const [filePath, entry] of timelineIndex) {
      for (const { label, date } of entry.dates) {
        const monthMatch = targetMonth === -1 || date.getMonth() === targetMonth;
        const yearMatches = targetYear === -1 || date.getFullYear() === targetYear;

        if (monthMatch && yearMatches) {
          results.push({
            path: filePath,
            score: label === 'filename' ? 1.0 : 0.7,
            snippet: `📅 ${date.toISOString().slice(0, 10)}: ${filePath} (${label})`,
            type: 'timeline',
            metadata: { date: date.toISOString(), dateSource: label },
          });
          break; // one result per file
        }
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },
};
