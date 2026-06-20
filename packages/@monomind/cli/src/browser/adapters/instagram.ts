// src/browser/adapters/instagram.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  baseURL: 'https://www.instagram.com',
  reservedPaths: ['/direct', '/explore', '/reels', '/stories'],
  loginURL: () => 'https://www.instagram.com/accounts/login/',
  async isLoggedIn(page: PageInterface): Promise<boolean> {
    return page.evaluate<boolean>('!!document.querySelector(\'svg[aria-label="Home"]\')');
  },
  async extractUsername(page: PageInterface): Promise<string> {
    // Use getAttribute to get the raw path-relative href (not the resolved absolute URL)
    return page.evaluate<string>("document.querySelector('a[href^=\"/\"]')?.getAttribute('href')?.split('/').filter(Boolean)[0] ?? ''");
  },
};
