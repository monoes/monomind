// src/browser/adapters/google.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const googleAdapter: PlatformAdapter = {
  platform: 'google',
  baseURL: 'https://accounts.google.com',
  reservedPaths: ['/signin', '/oauth', '/o/oauth2'],
  loginURL: () => 'https://accounts.google.com/signin/v2/identifier',
  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    // Logged in if we're on a Google service page (not the sign-in page)
    if (url.includes('accounts.google.com/signin')) return false;
    return page.evaluate<boolean>("!!(document.querySelector('[aria-label*=\"Google Account\"]') || document.querySelector('.gb_A') || document.cookie.includes('SSID'))");
  },
  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(
      "document.querySelector('[data-email]')?.getAttribute('data-email') ?? document.querySelector('.gb_A.gb_Sa')?.textContent?.trim() ?? ''"
    );
  },
};
