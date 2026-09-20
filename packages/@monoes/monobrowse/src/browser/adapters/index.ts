// src/browser/adapters/index.ts

export interface PageInterface {
  evaluate<T>(expression: string): Promise<T>;
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

import { geminiAdapter } from './gemini.js';
import { googleAdapter } from './google.js';
import { instagramAdapter } from './instagram.js';
import { linkedinAdapter } from './linkedin.js';
import { microsoftAdapter } from './microsoft.js';
import { xAdapter } from './x.js';

export const adapters: Map<string, PlatformAdapter> = new Map([
  ['linkedin', linkedinAdapter],
  ['instagram', instagramAdapter],
  ['x', xAdapter],
  ['gemini', geminiAdapter],
  ['google', googleAdapter],
  ['microsoft', microsoftAdapter],
]);

export function getAdapter(platform: string): PlatformAdapter {
  const adapter = adapters.get(platform);
  if (!adapter)
    throw new Error(`Unknown platform: ${platform}. Supported: ${[...adapters.keys()].join(', ')}`);
  return adapter;
}
