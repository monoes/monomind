import fs from 'fs';
import type {
  CapabilityModule,
  DirectoryScan,
  FileEntry,
  IndexResult,
  SearchResult,
  HealthCheck,
} from './types.js';

const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.heic',
  '.heif',
  '.webp',
  '.svg',
  '.raw',
  '.cr2',
  '.nef',
  '.tiff',
  '.tif',
]);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.wmv', '.flv', '.webm']);
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.flac', '.aac', '.ogg', '.m4a', '.wma']);
const ALL_MEDIA = new Set([...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

interface MediaEntry {
  path: string;
  type: 'image' | 'video' | 'audio';
  metadata: Record<string, unknown>;
  description: string; // from EXIF, filename, or CLIP (T2)
}

// In-memory index for T0 (metadata) — replaced by memory DB in production
const indexedMedia = new Map<string, MediaEntry>();

async function extractExif(file: FileEntry): Promise<Record<string, unknown>> {
  try {
    // monolean: exifreader is an optional dependency — degrade to metadata-only if missing
    const mod = await import('exifreader');
    const ExifReader = (mod as any).default ?? mod;
    const buffer = fs.readFileSync(file.absolutePath);
    const tags = ExifReader.load(buffer, { expanded: true });
    const result: Record<string, unknown> = {};
    if (tags.exif) {
      if (tags.exif.DateTimeOriginal) result.dateTaken = tags.exif.DateTimeOriginal.description;
      if (tags.exif.Make) result.cameraMake = tags.exif.Make.description;
      if (tags.exif.Model) result.cameraModel = tags.exif.Model.description;
      if (tags.exif.ImageWidth) result.width = tags.exif.ImageWidth.value;
      if (tags.exif.ImageLength) result.height = tags.exif.ImageLength.value;
    }
    if (tags.gps) {
      if (tags.gps.Latitude) result.latitude = tags.gps.Latitude;
      if (tags.gps.Longitude) result.longitude = tags.gps.Longitude;
    }
    return result;
  } catch {
    return {}; // exifreader not installed or file has no EXIF
  }
}

function mediaType(ext: string): 'image' | 'video' | 'audio' {
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'audio';
}

export const mediaCapability: CapabilityModule = {
  name: 'media',

  detect(scan: DirectoryScan): number {
    return scan.capabilities.media.confidence;
  },

  async activate(_rootDir: string): Promise<void> {
    indexedMedia.clear();
  },

  async index(files: FileEntry[]): Promise<IndexResult> {
    let indexed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const file of files) {
      if (!ALL_MEDIA.has(file.extension)) {
        skipped++;
        continue;
      }

      try {
        const exif = file.extension !== '.svg' ? await extractExif(file) : {};
        const type = mediaType(file.extension);

        // Build searchable description from metadata + filename
        const descParts = [file.path.replace(/[_-]/g, ' ')];
        if (exif.dateTaken) descParts.push(`taken ${exif.dateTaken}`);
        if (exif.cameraMake) descParts.push(`${exif.cameraMake} ${exif.cameraModel ?? ''}`);

        indexedMedia.set(file.path, {
          path: file.path,
          type,
          metadata: {
            ...exif,
            size: file.size,
            modified: file.modified.toISOString(),
            created: file.created.toISOString(),
            extension: file.extension,
          },
          description: descParts.join(' '),
        });
        indexed++;
      } catch (err) {
        errors.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    return { indexed, skipped, errors };
  },

  async search(query: string, limit = 20): Promise<SearchResult[]> {
    const queryLower = query.toLowerCase();
    const results: SearchResult[] = [];

    for (const [mediaPath, entry] of indexedMedia) {
      const descLower = entry.description.toLowerCase();
      const pathLower = mediaPath.toLowerCase();

      if (descLower.includes(queryLower) || pathLower.includes(queryLower)) {
        results.push({
          path: mediaPath,
          score: pathLower.includes(queryLower) ? 1.0 : 0.5,
          snippet: entry.description,
          type: 'media',
          metadata: entry.metadata,
        });
      }
    }

    return results.sort((a, b) => b.score - a.score).slice(0, limit);
  },

  async healthChecks(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    try {
      await import('exifreader');
      checks.push({ name: 'EXIF Extraction', status: 'pass', message: 'exifreader available' });
    } catch {
      checks.push({
        name: 'EXIF Extraction',
        status: 'warn',
        message: 'exifreader not installed',
        hint: 'pnpm add exifreader',
      });
    }
    return checks;
  },
};
