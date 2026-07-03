export type EnrichmentTier = 't0' | 't1' | 't2';
export type EnrichmentStatus = 'pending' | 'queued' | 'done' | 'skipped' | 'failed';
export type CapabilityName = 'code' | 'documents' | 'media' | 'data' | 'graph' | 'timeline';

export interface FileEntry {
  path: string;        // relative to scan root
  absolutePath: string;
  extension: string;   // lowercase, with dot: ".pdf"
  size: number;        // bytes
  modified: Date;
  created: Date;
}

export interface CapabilityScore {
  confidence: number;  // 0-1
  files: number;
  signals: string[];
}

export interface DirectoryScan {
  root: string;
  totalFiles: number;
  git: boolean;
  scannedAt: string;   // ISO 8601
  capabilities: Record<CapabilityName, CapabilityScore>;
  filesByExtension: Record<string, number>;
}

export interface Fingerprint extends DirectoryScan {
  version: 1;
}

export interface IndexResult {
  indexed: number;
  skipped: number;
  errors: string[];
}

export interface EnrichResult {
  enriched: number;
  skipped: number;
  errors: string[];
}

export interface SearchResult {
  path: string;
  score: number;
  snippet: string;
  type: CapabilityName;
  metadata?: Record<string, unknown>;
}

export interface HealthCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  hint?: string;
}

export interface EnrichmentState {
  [relativePath: string]: Record<EnrichmentTier, EnrichmentStatus>;
}

export interface CapabilityModule {
  name: CapabilityName;
  detect(scan: DirectoryScan): number;
  activate(rootDir: string): Promise<void>;
  index(files: FileEntry[]): Promise<IndexResult>;
  enrich?(files: FileEntry[]): Promise<EnrichResult>;
  search?(query: string, limit?: number): Promise<SearchResult[]>;
  healthChecks?(): Promise<HealthCheck[]>;
}
