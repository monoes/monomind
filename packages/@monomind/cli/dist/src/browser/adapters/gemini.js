export const geminiAdapter = {
    platform: 'gemini',
    baseURL: 'https://gemini.google.com',
    reservedPaths: ['/app', '/faq', '/privacy', '/terms', '/about'],
    loginURL: () => 'https://accounts.google.com/signin',
    async isLoggedIn(page) {
        const url = await page.url();
        if (url.includes('accounts.google.com'))
            return false;
        return page.evaluate(`!!document.querySelector('bard-sidenav, [data-test-id="bard-sidenav"]')`);
    },
    async extractUsername(page) {
        return page.evaluate(`(document.querySelector('[data-email]')?.getAttribute('data-email') ?? 'unknown')`);
    },
};
//# sourceMappingURL=gemini.js.map