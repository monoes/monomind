import type { PlatformAdapter, PageInterface } from './index.js';

export const geminiAdapter: PlatformAdapter = {
  platform: 'gemini',
  baseURL: 'https://gemini.google.com',
  reservedPaths: ['/app', '/faq', '/privacy', '/terms', '/about'],

  loginURL: () => 'https://accounts.google.com/signin',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('accounts.google.com')) return false;
    return page.evaluate<boolean>(
      `!!document.querySelector('bard-sidenav, [data-test-id="bard-sidenav"]')`
    );
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(
      `(document.querySelector('[data-email]')?.getAttribute('data-email') ?? 'unknown')`
    );
  },
};
