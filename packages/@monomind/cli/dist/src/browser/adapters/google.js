export const googleAdapter = {
    platform: 'google',
    baseURL: 'https://accounts.google.com',
    reservedPaths: ['/signin', '/oauth', '/o/oauth2'],
    loginURL: () => 'https://accounts.google.com/signin/v2/identifier',
    async isLoggedIn(page) {
        const url = await page.url();
        // Logged in if we're on a Google service page (not the sign-in page)
        if (url.includes('accounts.google.com/signin'))
            return false;
        return page.evaluate("!!(document.querySelector('[aria-label*=\"Google Account\"]') || document.querySelector('.gb_A') || document.cookie.includes('SSID'))");
    },
    async extractUsername(page) {
        return page.evaluate("document.querySelector('[data-email]')?.getAttribute('data-email') ?? document.querySelector('.gb_A.gb_Sa')?.textContent?.trim() ?? ''");
    },
};
//# sourceMappingURL=google.js.map