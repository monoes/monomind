import type { PlatformAdapter, PageInterface } from './index.js';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  baseURL: 'https://www.linkedin.com',
  reservedPaths: ['/feed', '/jobs', '/messaging', '/notifications', '/mynetwork', '/learning', '/search'],

  loginURL: () => 'https://www.linkedin.com/login',

  async isLoggedIn(page: PageInterface): Promise<boolean> {
    const url = await page.url();
    if (url.includes('/login') || url.includes('/authwall')) return false;
    const hasNav = await page.evaluate<boolean>(
      `!!document.querySelector('[data-control-name="nav.home"] ,nav.global-nav')`
    );
    return hasNav;
  },

  async extractUsername(page: PageInterface): Promise<string> {
    const profileUrl = await page.evaluate<string>(
      `(document.querySelector('a[href*="/in/"]')?.getAttribute('href') ?? '')`
    );
    const match = profileUrl.match(/\/in\/([^/?#]+)/);
    return match?.[1] ?? 'unknown';
  },
};
