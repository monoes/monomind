// src/browser/adapters/gemini.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const geminiAdapter: PlatformAdapter = {
  platform: 'gemini',
  baseURL: 'https://gemini.google.com',
  reservedPaths: ['/app', '/chat'],
  loginURL: () => 'https://accounts.google.com/signin/v2/identifier',
  async isLoggedIn(page: PageInterface): Promise<boolean> {
    return page.evaluate<boolean>("!!(document.querySelector('bard-sidenav') || document.querySelector('.ql-editor'))");
  },
  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>("document.querySelector('.gb_A.gb_Sa')?.textContent?.trim() ?? ''");
  },
};
