// src/browser/adapters/linkedin.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const linkedinAdapter: PlatformAdapter = {
  platform: 'linkedin',
  baseURL: 'https://www.linkedin.com',
  reservedPaths: ['/feed', '/jobs', '/messaging', '/notifications', '/me'],
  loginURL: () => 'https://www.linkedin.com/login',
  async isLoggedIn(page: PageInterface): Promise<boolean> {
    return page.evaluate<boolean>("!!document.querySelector('.global-nav__me-photo')");
  },
  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>("document.querySelector('.profile-rail-card__actor-link')?.textContent?.trim() ?? ''");
  },
};
