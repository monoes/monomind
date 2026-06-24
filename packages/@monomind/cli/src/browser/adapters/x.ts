import type { PlatformAdapter, PageInterface } from './index.js';

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  baseURL: 'https://x.com',
  reservedPaths: ['/home', '/explore', '/notifications', '/messages', '/i', '/search',
    '/settings', '/bookmarks', '/lists', '/profile', '/compose', '/trending'],

  loginURL: () => 'https://x.com/i/flow/login',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/i/flow/login') || url.includes('/login')) return false;
    return page.evaluate<boolean>(
      `!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')`
    );
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(`
      (document.querySelector('[data-testid="UserName"] span')?.textContent ?? 'unknown').trim()
    `);
  },
};
