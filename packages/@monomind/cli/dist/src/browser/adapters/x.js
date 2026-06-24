export const xAdapter = {
    platform: 'x',
    baseURL: 'https://x.com',
    reservedPaths: ['/home', '/explore', '/notifications', '/messages', '/i', '/search',
        '/settings', '/bookmarks', '/lists', '/profile', '/compose', '/trending'],
    loginURL: () => 'https://x.com/i/flow/login',
    async isLoggedIn(page) {
        const url = await page.url();
        if (url.includes('/i/flow/login') || url.includes('/login'))
            return false;
        return page.evaluate(`!!document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]')`);
    },
    async extractUsername(page) {
        return page.evaluate(`
      (document.querySelector('[data-testid="UserName"] span')?.textContent ?? 'unknown').trim()
    `);
    },
};
//# sourceMappingURL=x.js.map