import type { PlatformAdapter, PageInterface } from './index.js';

export const instagramAdapter: PlatformAdapter = {
  platform: 'instagram',
  baseURL: 'https://www.instagram.com',
  reservedPaths: ['/explore', '/reels', '/direct', '/stories', '/accounts', '/p', '/reel', '/tv'],

  loginURL: () => 'https://www.instagram.com/accounts/login/',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/accounts/login') || url.includes('/accounts/emailsignup')) return false;
    const hasAvatar = await page.evaluate<boolean>(
      `!!document.querySelector('img[alt*="profile picture"], [aria-label="Home"]')`
    );
    return hasAvatar;
  },

  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>(
      `(document.querySelector('a[href^="/"][href$="/"] span')?.textContent ?? 'unknown').trim()`
    );
  },
};
