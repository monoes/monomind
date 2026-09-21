// Log a test "browser" in to a dashboard started with startServer(): spend a
// one-time login link (ui/human-auth.mjs) and fetch the page with the session
// cookie it sets — the page only embeds the token for a logged-in browser.
// Uses the current $HOME, so point HOME at a fixture dir first.
// @ts-expect-error — .mjs sibling has no type declarations
import { issueLoginNonce } from '../../src/ui/human-auth.mjs';

export async function loggedInPage(
  baseUrl: string,
  path = '/',
): Promise<{ html: string; cookie: string }> {
  const r = await fetch(`${baseUrl}${path}?login=${issueLoginNonce()}`, { redirect: 'manual' });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  const html = await (await fetch(`${baseUrl}${path}`, { headers: { cookie } })).text();
  return { html, cookie };
}
