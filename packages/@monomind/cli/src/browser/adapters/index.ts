import type { CdpClient } from '@monoes/monobrowse';

export interface PageInterface {
  client: CdpClient;
  sessionId: string;
  evaluate<T>(fn: string): Promise<T>;
  url(): Promise<string>;
}

export interface PlatformAdapter {
  platform: string;
  baseURL: string;
  reservedPaths: string[];
  isLoggedIn(page: PageInterface): Promise<boolean>;
  loginURL(): string;
  extractUsername(page: PageInterface): Promise<string>;
}

const registry = new Map<string, PlatformAdapter>();

export function registerAdapter(adapter: PlatformAdapter): void {
  registry.set(adapter.platform, adapter);
}

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = registry.get(platform);
  if (!adapter) throw new Error(`Unknown platform: ${platform}. Available: ${[...registry.keys()].join(', ')}`);
  return adapter;
}

export function listAdapters(): PlatformAdapter[] {
  return [...registry.values()];
}

// Auto-register all adapters
import { linkedinAdapter } from './linkedin.js';
import { instagramAdapter } from './instagram.js';
import { xAdapter } from './x.js';
import { geminiAdapter } from './gemini.js';

registerAdapter(linkedinAdapter);
registerAdapter(instagramAdapter);
registerAdapter(xAdapter);
registerAdapter(geminiAdapter);
