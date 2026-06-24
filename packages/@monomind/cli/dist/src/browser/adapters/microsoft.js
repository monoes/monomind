export const microsoftAdapter = {
    platform: 'microsoft',
    baseURL: 'https://login.microsoftonline.com',
    reservedPaths: ['/oauth2', '/common/oauth2', '/kmsi'],
    loginURL: () => 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=common&response_type=code&scope=openid+profile+email',
    async isLoggedIn(page) {
        const url = await page.url();
        if (url.includes('login.microsoftonline.com') || url.includes('login.microsoft.com'))
            return false;
        return page.evaluate("!!(document.querySelector('[data-tid=\"user-email\"]') || document.querySelector('.mectrl_currentAccount') || document.cookie.includes('ESTSAUTH'))");
    },
    async extractUsername(page) {
        return page.evaluate("document.querySelector('[data-tid=\"user-email\"]')?.textContent?.trim() ?? document.querySelector('.mectrl_headerEmail')?.textContent?.trim() ?? ''");
    },
};
//# sourceMappingURL=microsoft.js.map