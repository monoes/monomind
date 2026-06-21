// src/browser/adapters/x.ts
import type { PlatformAdapter, PageInterface } from './index.js';

export const xAdapter: PlatformAdapter = {
  platform: 'x',
  baseURL: 'https://x.com',
  reservedPaths: ['/home', '/explore', '/notifications', '/messages'],
  loginURL: () => 'https://x.com/i/flow/login',
  async isLoggedIn(page: PageInterface): Promise<boolean> {
    return page.evaluate<boolean>('!!document.querySelector(\'[data-testid="SideNav_AccountSwitcher_Button"]\')');
  },
  async extractUsername(page: PageInterface): Promise<string> {
    return page.evaluate<string>("document.querySelector('[data-testid=\"SideNav_AccountSwitcher_Button\"] span')?.textContent?.trim() ?? ''");
  },
};
