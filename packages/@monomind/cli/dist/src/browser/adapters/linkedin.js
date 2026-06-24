export const linkedinAdapter = {
    platform: 'linkedin',
    baseURL: 'https://www.linkedin.com',
    reservedPaths: ['/feed', '/jobs', '/messaging', '/notifications', '/mynetwork', '/learning', '/search'],
    loginURL: () => 'https://www.linkedin.com/login',
    async isLoggedIn(page) {
        const url = await page.url();
        if (url.includes('/login') || url.includes('/authwall'))
            return false;
        const hasNav = await page.evaluate(`!!document.querySelector('[data-control-name="nav.home"] ,nav.global-nav')`);
        return hasNav;
    },
    async extractUsername(page) {
        const profileUrl = await page.evaluate(`(document.querySelector('a[href*="/in/"]')?.getAttribute('href') ?? '')`);
        const match = profileUrl.match(/\/in\/([^/?#]+)/);
        return match?.[1] ?? 'unknown';
    },
};
//# sourceMappingURL=linkedin.js.map