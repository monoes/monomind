<p align="center">
  <img src="https://raw.githubusercontent.com/monoes/monomind/main/assets/packages/monobrowse.png" alt="@monoes/monobrowse" width="600" />
</p>

# @monoes/monobrowse

[![npm version](https://img.shields.io/npm/v/@monoes/monobrowse?style=flat-square)](https://www.npmjs.com/package/@monoes/monobrowse)
[![license](https://img.shields.io/npm/l/@monoes/monobrowse?style=flat-square)](https://github.com/monoes/monomind/blob/main/LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D20-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)

**Browser automation via Chrome DevTools Protocol** — navigate, click, fill forms, take screenshots, and evaluate JavaScript in a real Chrome browser. No Puppeteer, no Playwright, no external binaries — just CDP over WebSocket.

> Part of the [Monomind](https://github.com/monoes/monomind) ecosystem. Powers `monomind browse`.

## Install

```bash
npm install @monoes/monobrowse
```

## CLI usage

```bash
# Via monomind
monomind browse open https://example.com
monomind browse screenshot --output page.png
monomind browse click "button.submit"
monomind browse eval "document.title"
```

## Programmatic usage

```typescript
import { Browser } from '@monoes/monobrowse';

const browser = new Browser();
await browser.connect();

await browser.navigate('https://example.com');
await browser.click('button.login');
await browser.fill('input[name="email"]', 'user@example.com');
await browser.screenshot({ path: 'result.png' });

const title = await browser.evaluate('document.title');
await browser.close();
```

## Features

- **Zero dependencies** on browser automation frameworks
- Direct CDP WebSocket connection to Chrome/Chromium
- Navigate, click, type, screenshot, evaluate JS
- Session management for multi-page workflows
- Headless and headed modes

## Why not Puppeteer/Playwright?

Monobrowse talks CDP directly — no 50+ MB framework download, no binary management, no version pinning against Chrome releases. It does what AI agents need (navigate, interact, screenshot, evaluate) without the weight.

## Links

- [GitHub](https://github.com/monoes/monomind)
- [Documentation](https://monoes.github.io/monomind/)
- [Issues](https://github.com/monoes/monomind/issues)

## License

MIT
