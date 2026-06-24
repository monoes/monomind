export const instagramAdapter = {
    platform: 'instagram',
    baseURL: 'https://www.instagram.com',
    reservedPaths: ['/explore', '/reels', '/direct', '/stories', '/accounts', '/p', '/reel', '/tv'],
    loginURL: () => 'https://www.instagram.com/accounts/login/',
    async isLoggedIn(page) {
        const url = await page.url();
        if (url.includes('/accounts/login') || url.includes('/accounts/emailsignup'))
            return false;
        const hasAvatar = await page.evaluate(`!!document.querySelector('img[alt*="profile picture"], [aria-label="Home"]')`);
        return hasAvatar;
    },
    async extractUsername(page) {
        return page.evaluate(`(document.querySelector('a[href^="/"][href$="/"] span')?.textContent ?? 'unknown').trim()`);
    },
};
//# sourceMappingURL=instagram.js.map