/**
 * npm lockfiles for the packages ensureOptionalDependency() installs (#428).
 * `npm ci` installs exactly these trees and checks every tarball against the
 * `integrity` recorded here, so a registry or ~/.npmrc that serves other
 * bytes fails the install instead of changing what runs.
 *
 * Regenerate after changing a pin in optional-deps.ts: in an empty directory,
 * write {"name":"monomind-optional-dependency","private":true,
 * "dependencies":{"<name>":"<version>"}} as package.json, run
 * `npm install --package-lock-only --legacy-peer-deps --ignore-scripts`, and
 * paste package-lock.json below. optional-deps.test.ts checks the pins match.
 */
import type { OptionalDependencyName } from './optional-deps.js';

export const OPTIONAL_DEPENDENCY_LOCKS = {
  '@anthropic-ai/claude-agent-sdk': {
    name: 'monomind-optional-dependency',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'monomind-optional-dependency',
        dependencies: {
          '@anthropic-ai/claude-agent-sdk': '0.3.319',
        },
      },
      'node_modules/@anthropic-ai/claude-agent-sdk': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.319.tgz',
        integrity:
          'sha512-7X+sh4uZv/u4OL4I4cQvMr9N3NM6FDiuyk829hFylgbrnNwVyiGElWEDWGuO26zwMIxmgpKdPoDILoFIHh1uwA==',
        license: 'SEE LICENSE IN README.md',
        engines: {
          node: '>=18.14.0',
        },
        optionalDependencies: {
          '@anthropic-ai/claude-agent-sdk-darwin-arm64': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-darwin-x64': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-linux-arm64': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-linux-arm64-musl': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-linux-x64': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-linux-x64-musl': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-win32-arm64': '0.3.319',
          '@anthropic-ai/claude-agent-sdk-win32-x64': '0.3.319',
        },
        peerDependencies: {
          '@anthropic-ai/sdk': '>=0.93.0',
          '@modelcontextprotocol/sdk': '^1.29.0',
          zod: '^4.0.0',
        },
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.319.tgz',
        integrity:
          'sha512-rNiAbMbRhgOM2CELsDTIq7q++sFVIZukTkgeswcncGbcX8STIgtf0XaZzKdRXtKK+v9ez+mQn8P4pb2Ka17wGA==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-x64/-/claude-agent-sdk-darwin-x64-0.3.319.tgz',
        integrity:
          'sha512-jM730Fl+cFotDnjF9cStIf+Xe57YdfDB3TXaSVVv8uVAXW4xoWFwIj2eDvmsciEEe5UMkKzjVqXu9kR21OrXng==',
        cpu: ['x64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-0.3.319.tgz',
        integrity:
          'sha512-g2tpMsHLMQahI4bk5CIcMHAB/RwzxoPGmL5Q5G5MDir5WTrl71vulWbtLQISUPm/yFPRG97tdzZnCa5Uq1v/dw==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64-musl/-/claude-agent-sdk-linux-arm64-musl-0.3.319.tgz',
        integrity:
          'sha512-8KDZQJAS2CEb5aGAvuXkpyHMc9TOM/zYTw2iKmbbVi4im0atw93EtJPapYyp0g/lQI/Xk8jMYdWU6Zlv9EWjLw==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-0.3.319.tgz',
        integrity:
          'sha512-uBAZA8x0hd5gVifyL5Lo73dVmi9xZeJ6jro2NO0al6yyWaw/6UL9xbsVh9lOhLFOmYIdSbQ2j4zAfnvG/t5F3Q==',
        cpu: ['x64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64-musl/-/claude-agent-sdk-linux-x64-musl-0.3.319.tgz',
        integrity:
          'sha512-XkKYj3c1jVFjLATrZr4YTsmS5AIb5s2iphF9X670EcVQqDCCGIKKTVNLLg9mg1e7D+2xX8FU0XNlOJatWfpBeA==',
        cpu: ['x64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-arm64/-/claude-agent-sdk-win32-arm64-0.3.319.tgz',
        integrity:
          'sha512-YoP0lYHJCziENFCotHQq9qd/gaJrwUNkAcnZyVjXxg1OPmtKuyw31aG60s4cWXRDXXGm/m1siNSQaGGfAYBvrw==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['win32'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64': {
        version: '0.3.319',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-0.3.319.tgz',
        integrity:
          'sha512-UC27x+8gfCS2OjNGJWrueP0gLOOKsLEsJ/kg0p6aa8GToZcJYjJ8KeAapHHRYMUAIB6Sarqe49Itm5P1wswCcQ==',
        cpu: ['x64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['win32'],
      },
    },
  },
  '@puppeteer/browsers': {
    name: 'monomind-optional-dependency',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'monomind-optional-dependency',
        dependencies: {
          '@puppeteer/browsers': '3.0.6',
        },
      },
      'node_modules/@puppeteer/browsers': {
        version: '3.0.6',
        resolved: 'https://registry.npmjs.org/@puppeteer/browsers/-/browsers-3.0.6.tgz',
        integrity:
          'sha512-B/gKoqlFkzhvzsI6jo9K1cZz9o5ypviVv/xu8CwA4grZzyVwN+XfkT+tu8T1zrauuEXv6VhS2oGX+6NL95WcKA==',
        license: 'Apache-2.0',
        dependencies: {
          'modern-tar': '^0.7.6',
          yargs: '^18.0.0',
        },
        bin: {
          browsers: 'lib/main-cli.js',
        },
        engines: {
          node: '>=22.12.0',
        },
        peerDependencies: {
          'proxy-agent': '>=8.0.1',
          yauzl: '^2.10.0 || ^3.4.0',
        },
        peerDependenciesMeta: {
          'proxy-agent': {
            optional: true,
          },
          yauzl: {
            optional: true,
          },
        },
      },
      'node_modules/ansi-regex': {
        version: '6.4.0',
        resolved: 'https://registry.npmjs.org/ansi-regex/-/ansi-regex-6.4.0.tgz',
        integrity:
          'sha512-KzTVk2tCWAHtYrvvvaP8bJKJq2pVinhLcGEQdtLIYPbmNGNyYe8QwNaTUYQp2J7/vIsUKt5QCqAfUkYyG9DkOw==',
        license: 'MIT',
        engines: {
          node: '>=12',
        },
        funding: {
          url: 'https://github.com/chalk/ansi-regex?sponsor=1',
        },
      },
      'node_modules/ansi-styles': {
        version: '6.2.3',
        resolved: 'https://registry.npmjs.org/ansi-styles/-/ansi-styles-6.2.3.tgz',
        integrity:
          'sha512-4Dj6M28JB+oAH8kFkTLUo+a2jwOFkuqb3yucU0CANcRRUbxS0cP0nZYCGjcc3BNXwRIsUVmDGgzawme7zvJHvg==',
        license: 'MIT',
        engines: {
          node: '>=12',
        },
        funding: {
          url: 'https://github.com/chalk/ansi-styles?sponsor=1',
        },
      },
      'node_modules/cliui': {
        version: '9.0.1',
        resolved: 'https://registry.npmjs.org/cliui/-/cliui-9.0.1.tgz',
        integrity:
          'sha512-k7ndgKhwoQveBL+/1tqGJYNz097I7WOvwbmmU2AR5+magtbjPWQTS1C5vzGkBC8Ym8UWRzfKUzUUqFLypY4Q+w==',
        license: 'ISC',
        dependencies: {
          'string-width': '^7.2.0',
          'strip-ansi': '^7.1.0',
          'wrap-ansi': '^9.0.0',
        },
        engines: {
          node: '>=20',
        },
      },
      'node_modules/cliui/node_modules/string-width': {
        version: '7.2.0',
        resolved: 'https://registry.npmjs.org/string-width/-/string-width-7.2.0.tgz',
        integrity:
          'sha512-tsaTIkKW9b4N+AEj+SVA+WhJzV7/zMhcSu78mLKWSk7cXMOSHsBKFWUs0fWwq8QyK3MgJBQRX6Gbi4kYbdvGkQ==',
        license: 'MIT',
        dependencies: {
          'emoji-regex': '^10.3.0',
          'get-east-asian-width': '^1.0.0',
          'strip-ansi': '^7.1.0',
        },
        engines: {
          node: '>=18',
        },
        funding: {
          url: 'https://github.com/sponsors/sindresorhus',
        },
      },
      'node_modules/emoji-regex': {
        version: '10.6.0',
        resolved: 'https://registry.npmjs.org/emoji-regex/-/emoji-regex-10.6.0.tgz',
        integrity:
          'sha512-toUI84YS5YmxW219erniWD0CIVOo46xGKColeNQRgOzDorgBi1v4D71/OFzgD9GO2UGKIv1C3Sp8DAn0+j5w7A==',
        license: 'MIT',
      },
      'node_modules/escalade': {
        version: '3.2.0',
        resolved: 'https://registry.npmjs.org/escalade/-/escalade-3.2.0.tgz',
        integrity:
          'sha512-WUj2qlxaQtO4g6Pq5c29GTcWGDyd8itL8zTlipgECz3JesAiiOKotd8JU6otB3PACgG6xkJUyVhboMS+bje/jA==',
        license: 'MIT',
        engines: {
          node: '>=6',
        },
      },
      'node_modules/get-caller-file': {
        version: '2.0.5',
        resolved: 'https://registry.npmjs.org/get-caller-file/-/get-caller-file-2.0.5.tgz',
        integrity:
          'sha512-DyFP3BM/3YHTQOCUL/w0OZHR0lpKeGrxotcHWcqNEdnltqFwXVfhEBQ94eIo34AfQpo0rGki4cyIiftY06h2Fg==',
        license: 'ISC',
        engines: {
          node: '6.* || 8.* || >= 10.*',
        },
      },
      'node_modules/get-east-asian-width': {
        version: '1.7.0',
        resolved:
          'https://registry.npmjs.org/get-east-asian-width/-/get-east-asian-width-1.7.0.tgz',
        integrity:
          'sha512-XjH1AECxf0giL2V1aU8vKyRR2ppRUb5c0EvT7zuJTokQ74bNo52zOtghqdWIqrhUD79fo3x0WfKZdOqxF6LG1Q==',
        license: 'MIT',
        engines: {
          node: '>=18',
        },
        funding: {
          url: 'https://github.com/sponsors/sindresorhus',
        },
      },
      'node_modules/modern-tar': {
        version: '0.7.7',
        resolved: 'https://registry.npmjs.org/modern-tar/-/modern-tar-0.7.7.tgz',
        integrity:
          'sha512-t9VmxaqrmANnEOBhpSDI6HD192Ge48k8vmWqQQL7hSFEqHEYwZbbsu49+aKLWZeRvFs3j1pMhXOqqF4kPlvjkQ==',
        license: 'MIT',
        engines: {
          node: '>=18.0.0',
        },
      },
      'node_modules/string-width': {
        version: '8.3.0',
        resolved: 'https://registry.npmjs.org/string-width/-/string-width-8.3.0.tgz',
        integrity:
          'sha512-ZbmZM0JCihQN91dWnxoipT2KOEyHqEyfRXUyjuRhW8b/xnqPDoq4gWEVApTVa9db2wN8mmoikgFBbjh71+cGeQ==',
        license: 'MIT',
        dependencies: {
          'get-east-asian-width': '^1.5.0',
          'strip-ansi': '^7.1.2',
        },
        engines: {
          node: '>=20',
        },
        funding: {
          url: 'https://github.com/sponsors/sindresorhus',
        },
      },
      'node_modules/strip-ansi': {
        version: '7.2.0',
        resolved: 'https://registry.npmjs.org/strip-ansi/-/strip-ansi-7.2.0.tgz',
        integrity:
          'sha512-yDPMNjp4WyfYBkHnjIRLfca1i6KMyGCtsVgoKe/z1+6vukgaENdgGBZt+ZmKPc4gavvEZ5OgHfHdrazhgNyG7w==',
        license: 'MIT',
        dependencies: {
          'ansi-regex': '^6.2.2',
        },
        engines: {
          node: '>=12',
        },
        funding: {
          url: 'https://github.com/chalk/strip-ansi?sponsor=1',
        },
      },
      'node_modules/wrap-ansi': {
        version: '9.0.2',
        resolved: 'https://registry.npmjs.org/wrap-ansi/-/wrap-ansi-9.0.2.tgz',
        integrity:
          'sha512-42AtmgqjV+X1VpdOfyTGOYRi0/zsoLqtXQckTmqTeybT+BDIbM/Guxo7x3pE2vtpr1ok6xRqM9OpBe+Jyoqyww==',
        license: 'MIT',
        dependencies: {
          'ansi-styles': '^6.2.1',
          'string-width': '^7.0.0',
          'strip-ansi': '^7.1.0',
        },
        engines: {
          node: '>=18',
        },
        funding: {
          url: 'https://github.com/chalk/wrap-ansi?sponsor=1',
        },
      },
      'node_modules/wrap-ansi/node_modules/string-width': {
        version: '7.2.0',
        resolved: 'https://registry.npmjs.org/string-width/-/string-width-7.2.0.tgz',
        integrity:
          'sha512-tsaTIkKW9b4N+AEj+SVA+WhJzV7/zMhcSu78mLKWSk7cXMOSHsBKFWUs0fWwq8QyK3MgJBQRX6Gbi4kYbdvGkQ==',
        license: 'MIT',
        dependencies: {
          'emoji-regex': '^10.3.0',
          'get-east-asian-width': '^1.0.0',
          'strip-ansi': '^7.1.0',
        },
        engines: {
          node: '>=18',
        },
        funding: {
          url: 'https://github.com/sponsors/sindresorhus',
        },
      },
      'node_modules/y18n': {
        version: '5.0.8',
        resolved: 'https://registry.npmjs.org/y18n/-/y18n-5.0.8.tgz',
        integrity:
          'sha512-0pfFzegeDWJHJIAmTLRP2DwHjdF5s7jo9tuztdQxAhINCdvS+3nGINqPd00AphqJR/0LhANUS6/+7SCb98YOfA==',
        license: 'ISC',
        engines: {
          node: '>=10',
        },
      },
      'node_modules/yargs': {
        version: '18.2.0',
        resolved: 'https://registry.npmjs.org/yargs/-/yargs-18.2.0.tgz',
        integrity:
          'sha512-9OpKOLeaoNFecEp7P6iYbzze/5CqWoH7N3SMs/6y1XF4nMvFMspEGZzJ6uFi9MmQwXhyzqYoSEKO3tvA3Z/o2w==',
        license: 'MIT',
        dependencies: {
          cliui: '^9.0.1',
          escalade: '^3.1.1',
          'get-caller-file': '^2.0.5',
          'string-width': '^8.2.1',
          y18n: '^5.0.5',
          'yargs-parser': '^22.0.0',
        },
        engines: {
          node: '^20.19.0 || ^22.12.0 || >=23',
        },
      },
      'node_modules/yargs-parser': {
        version: '22.0.0',
        resolved: 'https://registry.npmjs.org/yargs-parser/-/yargs-parser-22.0.0.tgz',
        integrity:
          'sha512-rwu/ClNdSMpkSrUb+d6BRsSkLUq1fmfsY6TOpYzTwvwkg1/NRG85KBy3kq++A8LKQwX6lsu+aWad+2khvuXrqw==',
        license: 'ISC',
        engines: {
          node: '^20.19.0 || ^22.12.0 || >=23',
        },
      },
    },
  },
  'monofence-ai': {
    name: 'monomind-optional-dependency',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'monomind-optional-dependency',
        dependencies: {
          'monofence-ai': '2.24.0',
        },
      },
      'node_modules/monofence-ai': {
        version: '2.24.0',
        resolved: 'https://registry.npmjs.org/monofence-ai/-/monofence-ai-2.24.0.tgz',
        integrity:
          'sha512-e3zpL/g+pNyFLx7mAVUz/rqkZDv5KDhp/0pl7Ry0QmLR0TEHkgn6Czd7ITOcZ16NWGOa4Vq6oX+Qs3YwfGAneA==',
        license: 'Apache-2.0',
        engines: {
          node: '>=22.12.0',
        },
      },
    },
  },
  '@huggingface/transformers': {
    name: 'monomind-optional-dependency',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': {
        name: 'monomind-optional-dependency',
        dependencies: {
          '@huggingface/transformers': '4.3.0',
        },
      },
      'node_modules/@emnapi/runtime': {
        version: '1.11.3',
        resolved: 'https://registry.npmjs.org/@emnapi/runtime/-/runtime-1.11.3.tgz',
        integrity:
          'sha512-Xz4Tpyki7XyrpbUK1jR1AhdAdaXyhhY4lZ3neLodmhpuWfy2PAQN5B46sAiU4liOXGLkHypn/qU+jvfWSCYYLA==',
        license: 'MIT',
        optional: true,
        dependencies: {
          tslib: '^2.4.0',
        },
      },
      'node_modules/@huggingface/jinja': {
        version: '0.5.11',
        resolved: 'https://registry.npmjs.org/@huggingface/jinja/-/jinja-0.5.11.tgz',
        integrity:
          'sha512-YzEzwM5oQf4r0vs7ifWQ+yuVR1YkAHrjERQ+a8WRsStHHp4NRBg+NesjiFc+X2AFUpRvvrIeHDS1xFy9jY/IjQ==',
        license: 'MIT',
        engines: {
          node: '>=18',
        },
      },
      'node_modules/@huggingface/tokenizers': {
        version: '0.2.0',
        resolved: 'https://registry.npmjs.org/@huggingface/tokenizers/-/tokenizers-0.2.0.tgz',
        integrity:
          'sha512-LidMHe1FpcSYH4vcSjXooda34pC0M8m1gmDOv7SQi6Iv+ib1zX7J3sHBCC9/3FPCkn2k1b55FneVqMRxrr99pg==',
        license: 'Apache-2.0',
      },
      'node_modules/@huggingface/transformers': {
        version: '4.3.0',
        resolved: 'https://registry.npmjs.org/@huggingface/transformers/-/transformers-4.3.0.tgz',
        integrity:
          'sha512-fL1A/WUZwouPrOlYxU5dzIwD2T5J781JiB2jDR8bFe5DwCj0Gfudq+NEXCMno49kQgajHA7xQkrRLJlqG1veEA==',
        license: 'Apache-2.0',
        dependencies: {
          '@huggingface/jinja': '^0.5.10',
          '@huggingface/tokenizers': '^0.2.0',
          'onnxruntime-node': '1.30.0',
          'onnxruntime-web': '1.31.0-dev.20260914-8d85527a0',
          sharp: '^0.35.4',
        },
      },
      'node_modules/@img/colour': {
        version: '1.1.0',
        resolved: 'https://registry.npmjs.org/@img/colour/-/colour-1.1.0.tgz',
        integrity:
          'sha512-Td76q7j57o/tLVdgS746cYARfSyxk8iEfRxewL9h4OMzYhbW4TAcppl0mT4eyqXddh6L/jwoM75mo7ixa/pCeQ==',
        license: 'MIT',
        engines: {
          node: '>=18',
        },
      },
      'node_modules/@img/sharp-darwin-arm64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-darwin-arm64/-/sharp-darwin-arm64-0.35.5.tgz',
        integrity:
          'sha512-QRUlFQ0WxvdWyqqG/WtI3iupfD5rBzmCHXSdPsY91sAtVtTo7Q4cb6zOccZ3gqEqkr0f1As1ehLqmEpDsRf+lg==',
        cpu: ['arm64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['darwin'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-darwin-arm64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-darwin-x64': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-darwin-x64/-/sharp-darwin-x64-0.35.5.tgz',
        integrity:
          'sha512-+BR255RhDlpygUpOc/Jdt1nT6DQ3XG/ERo5wbcdOf5Q320dKtPCKPLR1LJs9VGXRaMa8l1uUa0tkCNOXiAxZUw==',
        cpu: ['x64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['darwin'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-darwin-x64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-freebsd-wasm32': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-freebsd-wasm32/-/sharp-freebsd-wasm32-0.35.5.tgz',
        integrity:
          'sha512-Y/z91nEZ4uIBX5X3nfTovjU9lHNKFYbL2lpHCLVNmXQK03VIZvXBBt0KxbPGp2SdGSF+2mQU4e+hQaWOt86iAw==',
        license: 'Apache-2.0',
        optional: true,
        os: ['freebsd'],
        dependencies: {
          '@img/sharp-wasm32': '0.35.5',
        },
        engines: {
          node: '>=20.9.0',
        },
      },
      'node_modules/@img/sharp-libvips-darwin-arm64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-darwin-arm64/-/sharp-libvips-darwin-arm64-1.3.4.tgz',
        integrity:
          'sha512-5R89nBYiRdUlSWJxPhO+GVtaXzXSxKnRu/xqMn3KTA3L9EB9Oy/P+Nn2f2vlhPuUdy/Zusb2DarbyTpGCfEDuw==',
        cpu: ['arm64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@img/sharp-libvips-darwin-x64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-darwin-x64/-/sharp-libvips-darwin-x64-1.3.4.tgz',
        integrity:
          'sha512-iR2OKH80yi0U+dUplyh3/xdpFvps6YkCwsXenIJxqxR1v9o+xtKTGbS9H7cps+2Vxjc8B1j96p75NmTGjIhtpQ==',
        cpu: ['x64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@img/sharp-libvips-linux-arm': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-arm/-/sharp-libvips-linux-arm-1.3.4.tgz',
        integrity:
          'sha512-LmRtTsOHuvM2+wlO2Db37dx5MiZhB0FvSunciw48YjdOkZz9KAiRbm8ujeMOA1INqmei5NapFxYEK1D1ZSidmw==',
        cpu: ['arm'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linux-arm64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-arm64/-/sharp-libvips-linux-arm64-1.3.4.tgz',
        integrity:
          'sha512-Y3dgX/6lE2QhQb+Gxy0WZxfg9MEm/JBjamZpS2IklP7xIQoKN4hzAm7KcMVGtaVDt3neE9OKBC7vAfonA/Lr1A==',
        cpu: ['arm64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linux-ppc64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-ppc64/-/sharp-libvips-linux-ppc64-1.3.4.tgz',
        integrity:
          'sha512-Le6boB8Tai0Nis+gIxIpKx68UDVVIqdR8Tin5Yf1z2LJJQLDJvCDRqRu+jC2qCoD+eIomonmOwB4smBRxfVpYQ==',
        cpu: ['ppc64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linux-riscv64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-riscv64/-/sharp-libvips-linux-riscv64-1.3.4.tgz',
        integrity:
          'sha512-aHkkIEHPRdQEegJN20MLmGtxYD9R2wQr3Cwpddnu5+YKMt6Uzax7S9h5gpZTo8wyrGuZSlfQ63OevL5mTyOC7Q==',
        cpu: ['riscv64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linux-s390x': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-s390x/-/sharp-libvips-linux-s390x-1.3.4.tgz',
        integrity:
          'sha512-ra/mB6MikESDUO7Yg+Mi95bFBb9GsObURuhnOv3OqknjGe9sZrG8tCe9q0xSIGrtLgvgw0gKnFWcK4blSgQOuQ==',
        cpu: ['s390x'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linux-x64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linux-x64/-/sharp-libvips-linux-x64-1.3.4.tgz',
        integrity:
          'sha512-GJ//SSXbnwSDes02umB3nDJLFcQzw8a18V8fyhqr6tV515tOEMdImjjxj1AoafMRz56F3PHgftnj1QEKSU1zkw==',
        cpu: ['x64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linuxmusl-arm64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linuxmusl-arm64/-/sharp-libvips-linuxmusl-arm64-1.3.4.tgz',
        integrity:
          'sha512-hvulFwtjUcagsis6BBxHwGFwWoNZjgYmULGVrZcyfNbjA8hKILbRxGg15/7w5HDyXHXUos/j6baAWqnCyQ2DWA==',
        cpu: ['arm64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-libvips-linuxmusl-x64': {
        version: '1.3.4',
        resolved:
          'https://registry.npmjs.org/@img/sharp-libvips-linuxmusl-x64/-/sharp-libvips-linuxmusl-x64-1.3.4.tgz',
        integrity:
          'sha512-6zXKeE/p39I1AmA3cJG35eyBGNqNddLnUXjhwBnsGjFPWqf5VKkDBEqaEkPDoTEtkxwi2vv8Tcr2mDyP4So7Fg==',
        cpu: ['x64'],
        license: 'LGPL-3.0-or-later',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@img/sharp-linux-arm': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-linux-arm/-/sharp-linux-arm-0.35.5.tgz',
        integrity:
          'sha512-LEaXK2WdXVK5ykcw0buWyPMsmLLL2vpHLD6yrNSW+JGEL3BZPA4tpKN6iaMc4AxTTAoaX/sU1rOL51lcIz48ZQ==',
        cpu: ['arm'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-arm': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linux-arm64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linux-arm64/-/sharp-linux-arm64-0.35.5.tgz',
        integrity:
          'sha512-LYVx5JTsOM2CBzmxreh+nl64/3H6Xb09iSLknqH47z2T2DFFxDeFLP5y4dJwe6H7uGQlHPyEEtIqyo3DYsRwdQ==',
        cpu: ['arm64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-arm64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linux-ppc64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linux-ppc64/-/sharp-linux-ppc64-0.35.5.tgz',
        integrity:
          'sha512-QVxAAq8evVRI9ia2vqgwrmWucn5Dfv+JdWzj75pD8omHLPSP7f8p20O8jxzjCcuCEQEOtYOZUmX1hkiZ0kdevA==',
        cpu: ['ppc64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-ppc64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linux-riscv64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linux-riscv64/-/sharp-linux-riscv64-0.35.5.tgz',
        integrity:
          'sha512-LtdreXguaavKODPIfzJ4kffx7UNt1omwtK0rch4EBbbSTXPnxWmYSayXdLJw0fJzQ97kHt1gL/yh4tvU+nCyRQ==',
        cpu: ['riscv64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-riscv64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linux-s390x': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linux-s390x/-/sharp-linux-s390x-0.35.5.tgz',
        integrity:
          'sha512-UZasTOFiYzotTsGOCu42BfUzP6Tu6Do/947iRm1RsLKvlllxwGcn4RN27LibGWceix4Y+Pmw3jsnTcCQIgWjqA==',
        cpu: ['s390x'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-s390x': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linux-x64': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-linux-x64/-/sharp-linux-x64-0.35.5.tgz',
        integrity:
          'sha512-SxFtLTeJInhAA9Q836kux2vZNeOBQEx658qvbboZScr0wIARym3IcGmW7KpVD5sbVg0Ojy+udFQdayYIZyoNog==',
        cpu: ['x64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linux-x64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linuxmusl-arm64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linuxmusl-arm64/-/sharp-linuxmusl-arm64-0.35.5.tgz',
        integrity:
          'sha512-9HbMclmI1zlNkFRs3z9/eBtDjfD0sGlrX1z6b1qwmiFY5ElDLh4BC0LPBdVp7z1DXFiKlIcznf+ZlsuZzLxQqg==',
        cpu: ['arm64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linuxmusl-arm64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-linuxmusl-x64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-linuxmusl-x64/-/sharp-linuxmusl-x64-0.35.5.tgz',
        integrity:
          'sha512-4KOphqB035HrVdqLZfCgMzzERrQkkzOwRhl4OAkRO1YCldbaFjySXMaK534Mo0V+LndnlJk+sbUyLeU0ULyD1A==',
        cpu: ['x64'],
        license: 'Apache-2.0',
        optional: true,
        os: ['linux'],
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-libvips-linuxmusl-x64': '1.3.4',
        },
      },
      'node_modules/@img/sharp-wasm32': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-wasm32/-/sharp-wasm32-0.35.5.tgz',
        integrity:
          'sha512-Ptsga1su4tQx+LLF1ECS9U6nz5kmrXKo6XVbtR48Ke3ZRxxgaWBu7IDtEe1quo8hiupwm6WFqxVlXaSf7IINGQ==',
        license: 'Apache-2.0 AND LGPL-3.0-or-later AND MIT',
        optional: true,
        dependencies: {
          '@emnapi/runtime': '^1.11.3',
        },
        engines: {
          node: '>=20.9.0',
        },
      },
      'node_modules/@img/sharp-webcontainers-wasm32': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-webcontainers-wasm32/-/sharp-webcontainers-wasm32-0.35.5.tgz',
        integrity:
          'sha512-hfhF/FmoQyTUkA0bIKFOtw536BQSeBMe6BF6QyWlrPxT754+TFLaZ7sKKTfvvM0yJgKgaYTwnFCIZ/GuDw5SUA==',
        cpu: ['wasm32'],
        license: 'Apache-2.0',
        optional: true,
        dependencies: {
          '@img/sharp-wasm32': '0.35.5',
        },
        engines: {
          node: '>=20.9.0',
        },
      },
      'node_modules/@img/sharp-win32-arm64': {
        version: '0.35.5',
        resolved:
          'https://registry.npmjs.org/@img/sharp-win32-arm64/-/sharp-win32-arm64-0.35.5.tgz',
        integrity:
          'sha512-X4t7g+7ZA5DKblCBEXGjUqqemj4vczING/5viFwAL8h4N3qYeyjwdCvRLHi4EdOUI+2Z7UFlp1VM+p/AuEtm6Q==',
        cpu: ['arm64'],
        license: 'Apache-2.0 AND LGPL-3.0-or-later',
        optional: true,
        os: ['win32'],
        engines: {
          node: '>=20.9.0',
        },
      },
      'node_modules/@img/sharp-win32-ia32': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-win32-ia32/-/sharp-win32-ia32-0.35.5.tgz',
        integrity:
          'sha512-5Zm82LoBc43nhwNybZlG7Y1KO//Zhsn306fQl29ZOuStHLGTo3BWL83q3cznX0poxSAMuYL1On/BHBxkBeKr6A==',
        cpu: ['ia32'],
        license: 'Apache-2.0 AND LGPL-3.0-or-later',
        optional: true,
        os: ['win32'],
        engines: {
          node: '^20.9.0',
        },
      },
      'node_modules/@img/sharp-win32-x64': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/@img/sharp-win32-x64/-/sharp-win32-x64-0.35.5.tgz',
        integrity:
          'sha512-x76eH0vEiHlcMQu8Y8IenntaACtddpT6W0wmXtWrnKcnKI7ME5DdgqhAD6SEWOEl1v2zDvkZDhFA9KnURwpfqg==',
        cpu: ['x64'],
        license: 'Apache-2.0 AND LGPL-3.0-or-later',
        optional: true,
        os: ['win32'],
        engines: {
          node: '>=20.9.0',
        },
      },
      'node_modules/@protobufjs/aspromise': {
        version: '1.1.2',
        resolved: 'https://registry.npmjs.org/@protobufjs/aspromise/-/aspromise-1.1.2.tgz',
        integrity:
          'sha512-j+gKExEuLmKwvz3OgROXtrJ2UG2x8Ch2YZUxahh+s1F2HZ+wAceUNLkvy6zKCPVRkU++ZWQrdxsUeQXmcg4uoQ==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/base64': {
        version: '1.1.2',
        resolved: 'https://registry.npmjs.org/@protobufjs/base64/-/base64-1.1.2.tgz',
        integrity:
          'sha512-AZkcAA5vnN/v4PDqKyMR5lx7hZttPDgClv83E//FMNhR2TMcLUhfRUBHCmSl0oi9zMgDDqRUJkSxO3wm85+XLg==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/codegen': {
        version: '2.0.5',
        resolved: 'https://registry.npmjs.org/@protobufjs/codegen/-/codegen-2.0.5.tgz',
        integrity:
          'sha512-zgXFLzW3Ap33e6d0Wlj4MGIm6Ce8O89n/apUaGNB/jx+hw+ruWEp7EwGUshdLKVRCxZW12fp9r40E1mQrf/34g==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/eventemitter': {
        version: '1.1.1',
        resolved: 'https://registry.npmjs.org/@protobufjs/eventemitter/-/eventemitter-1.1.1.tgz',
        integrity:
          'sha512-vW1GmwMZNnL+gMRaovlh9yZX74kc+TTU3FObkkurpMaRtBfLP3ldjS9KQWlwZgraRE0+dheEEoAxdzcJQ8eXZg==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/fetch': {
        version: '1.1.1',
        resolved: 'https://registry.npmjs.org/@protobufjs/fetch/-/fetch-1.1.1.tgz',
        integrity:
          'sha512-GpptLrs57adMSuHi3VNj0mAF8dwh36LMaYF6XyJ6JMWlVsc+t42tm1HSEDmOs3A8fC9yyeisgLhsTVQokOZ0zw==',
        license: 'BSD-3-Clause',
        dependencies: {
          '@protobufjs/aspromise': '^1.1.1',
        },
      },
      'node_modules/@protobufjs/float': {
        version: '1.0.2',
        resolved: 'https://registry.npmjs.org/@protobufjs/float/-/float-1.0.2.tgz',
        integrity:
          'sha512-Ddb+kVXlXst9d+R9PfTIxh1EdNkgoRe5tOX6t01f1lYWOvJnSPDBlG241QLzcyPdoNTsblLUdujGSE4RzrTZGQ==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/path': {
        version: '1.1.2',
        resolved: 'https://registry.npmjs.org/@protobufjs/path/-/path-1.1.2.tgz',
        integrity:
          'sha512-6JOcJ5Tm08dOHAbdR3GrvP+yUUfkjG5ePsHYczMFLq3ZmMkAD98cDgcT2iA1lJ9NVwFd4tH/iSSoe44YWkltEA==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/pool': {
        version: '1.1.0',
        resolved: 'https://registry.npmjs.org/@protobufjs/pool/-/pool-1.1.0.tgz',
        integrity:
          'sha512-0kELaGSIDBKvcgS4zkjz1PeddatrjYcmMWOlAuAPwAeccUrPHdUqo/J6LiymHHEiJT5NrF1UVwxY14f+fy4WQw==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@protobufjs/utf8': {
        version: '1.1.2',
        resolved: 'https://registry.npmjs.org/@protobufjs/utf8/-/utf8-1.1.2.tgz',
        integrity:
          'sha512-b1UQwcEZ4yCnMCD8DAL1VlbvBJE9/IX4FTIp7BG1xYpf29SLazLSrqUkj4w7Y5y7cCVP6E5tcqqcI0xemPkHug==',
        license: 'BSD-3-Clause',
      },
      'node_modules/@types/node': {
        version: '26.6.6',
        resolved: 'https://registry.npmjs.org/@types/node/-/node-26.6.6.tgz',
        integrity:
          'sha512-MzQj+8Kx3XI40OmUAE6Qoh58ZMNstNNMwn2nfd3qWsfe7nDNSqJNzes4njhz6AHwrSHOffSLwXU6yb474Q4aog==',
        license: 'MIT',
        dependencies: {
          'undici-types': '~8.9.0',
        },
      },
      'node_modules/adm-zip': {
        version: '0.6.1',
        resolved: 'https://registry.npmjs.org/adm-zip/-/adm-zip-0.6.1.tgz',
        integrity:
          'sha512-Xwrja8nx9e5o2N1my4DsKCeKpdrnACyr1wtbPxBDgGzKzKyE9kRtBFA8mWldI+RVlD7CBZNWY/wQ2+ydwOR6kQ==',
        license: 'MIT',
        engines: {
          node: '>=14.0',
        },
      },
      'node_modules/define-data-property': {
        version: '1.1.4',
        resolved:
          'https://registry.npmjs.org/define-data-property/-/define-data-property-1.1.4.tgz',
        integrity:
          'sha512-rBMvIzlpA8v6E+SJZoo++HAYqsLrkg7MSfIinMPFhmkorw7X+dOXVJQs+QT69zGkzMyfDnIMN2Wid1+NbL3T+A==',
        license: 'MIT',
        dependencies: {
          'es-define-property': '^1.0.0',
          'es-errors': '^1.3.0',
          gopd: '^1.0.1',
        },
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/define-properties': {
        version: '1.2.1',
        resolved: 'https://registry.npmjs.org/define-properties/-/define-properties-1.2.1.tgz',
        integrity:
          'sha512-8QmQKqEASLd5nx0U1B1okLElbUuuttJ/AnYmRXbbbGDWh6uS208EjD4Xqq/I9wK7u0v6O08XhTWnt5XtEbR6Dg==',
        license: 'MIT',
        dependencies: {
          'define-data-property': '^1.0.1',
          'has-property-descriptors': '^1.0.0',
          'object-keys': '^1.1.1',
        },
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/detect-libc': {
        version: '2.1.2',
        resolved: 'https://registry.npmjs.org/detect-libc/-/detect-libc-2.1.2.tgz',
        integrity:
          'sha512-Btj2BOOO83o3WyH59e8MgXsxEQVcarkUOpEYrubB0urwnN10yQ364rsiByU11nZlqWYZm05i/of7io4mzihBtQ==',
        license: 'Apache-2.0',
        engines: {
          node: '>=8',
        },
      },
      'node_modules/es-define-property': {
        version: '1.0.1',
        resolved: 'https://registry.npmjs.org/es-define-property/-/es-define-property-1.0.1.tgz',
        integrity:
          'sha512-e3nRfgfUZ4rNGL232gUgX06QNyyez04KdjFrF+LTRoOXmrOgFKDg4BCdsjW8EnT69eqdYGmRpJwiPVYNrCaW3g==',
        license: 'MIT',
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/es-errors': {
        version: '1.3.0',
        resolved: 'https://registry.npmjs.org/es-errors/-/es-errors-1.3.0.tgz',
        integrity:
          'sha512-Zf5H2Kxt2xjTvbJvP2ZWLEICxA6j+hAmMzIlypy4xcBg1vKVnx89Wy0GbS+kf5cwCVFFzdCFh2XSCFNULS6csw==',
        license: 'MIT',
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/escape-string-regexp': {
        version: '4.0.0',
        resolved:
          'https://registry.npmjs.org/escape-string-regexp/-/escape-string-regexp-4.0.0.tgz',
        integrity:
          'sha512-TtpcNJ3XAzx3Gq8sWRzJaVajRs0uVxA2YAkdb1jm2YkPz4G6egUFAyA3n5vtEIZefPk5Wa4UXbKuS5fKkJWdgA==',
        license: 'MIT',
        engines: {
          node: '>=10',
        },
      },
      'node_modules/flatbuffers': {
        version: '25.9.23',
        resolved: 'https://registry.npmjs.org/flatbuffers/-/flatbuffers-25.9.23.tgz',
        integrity:
          'sha512-MI1qs7Lo4Syw0EOzUl0xjs2lsoeqFku44KpngfIduHBYvzm8h2+7K8YMQh1JtVVVrUvhLpNwqVi4DERegUJhPQ==',
        license: 'Apache-2.0',
      },
      'node_modules/global-agent': {
        version: '4.1.6',
        resolved: 'https://registry.npmjs.org/global-agent/-/global-agent-4.1.6.tgz',
        integrity:
          'sha512-V9u791atI/bS7RryfRTK2oixDWo6/RCrIikjwuQ4kADPRZZml1C6LUJXc7y6qRhaAF8geo3bIvE/siAGJCw38A==',
        license: 'BSD-3-Clause',
        dependencies: {
          globalthis: '^1.0.2',
          matcher: '^4.0.0',
          semver: '^7.3.5',
          'serialize-error': '^8.1.0',
        },
        engines: {
          node: '>=10.0',
        },
      },
      'node_modules/globalthis': {
        version: '1.0.4',
        resolved: 'https://registry.npmjs.org/globalthis/-/globalthis-1.0.4.tgz',
        integrity:
          'sha512-DpLKbNU4WylpxJykQujfCcwYWiV/Jhm50Goo0wrVILAv5jOr9d+H+UR3PhSCD2rCCEIg0uc+G+muBTwD54JhDQ==',
        license: 'MIT',
        dependencies: {
          'define-properties': '^1.2.1',
          gopd: '^1.0.1',
        },
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/gopd': {
        version: '1.2.0',
        resolved: 'https://registry.npmjs.org/gopd/-/gopd-1.2.0.tgz',
        integrity:
          'sha512-ZUKRh6/kUFoAiTAtTYPZJ3hw9wNxx+BIBOijnlG9PnrJsCcSjs1wyyD6vJpaYtgnzDrKYRSqf3OO6Rfa93xsRg==',
        license: 'MIT',
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/guid-typescript': {
        version: '1.0.9',
        resolved: 'https://registry.npmjs.org/guid-typescript/-/guid-typescript-1.0.9.tgz',
        integrity:
          'sha512-Y8T4vYhEfwJOTbouREvG+3XDsjr8E3kIr7uf+JZ0BYloFsttiHU0WfvANVsR7TxNUJa/WpCnw/Ino/p+DeBhBQ==',
        license: 'ISC',
      },
      'node_modules/has-property-descriptors': {
        version: '1.0.2',
        resolved:
          'https://registry.npmjs.org/has-property-descriptors/-/has-property-descriptors-1.0.2.tgz',
        integrity:
          'sha512-55JNKuIW+vq4Ke1BjOTjM2YctQIvCT7GFzHwmfZPGo5wnrgkid0YQtnAleFSqumZm4az3n2BS+erby5ipJdgrg==',
        license: 'MIT',
        dependencies: {
          'es-define-property': '^1.0.0',
        },
      },
      'node_modules/long': {
        version: '5.3.2',
        resolved: 'https://registry.npmjs.org/long/-/long-5.3.2.tgz',
        integrity:
          'sha512-mNAgZ1GmyNhD7AuqnTG3/VQ26o760+ZYBPKjPvugO8+nLbYfX6TVpJPseBvopbdY+qpZ/lKUnmEc1LeZYS3QAA==',
        license: 'Apache-2.0',
      },
      'node_modules/matcher': {
        version: '4.0.0',
        resolved: 'https://registry.npmjs.org/matcher/-/matcher-4.0.0.tgz',
        integrity:
          'sha512-S6x5wmcDmsDRRU/c2dkccDwQPXoFczc5+HpQ2lON8pnvHlnvHAHj5WlLVvw6n6vNyHuVugYrFohYxbS+pvFpKQ==',
        license: 'MIT',
        dependencies: {
          'escape-string-regexp': '^4.0.0',
        },
        engines: {
          node: '>=10',
        },
      },
      'node_modules/object-keys': {
        version: '1.1.1',
        resolved: 'https://registry.npmjs.org/object-keys/-/object-keys-1.1.1.tgz',
        integrity:
          'sha512-NuAESUOUMrlIXOfHKzD6bpPu3tYt3xvjNdRIQ+FeT0lNb4K8WR70CaDxhuNguS2XG+GjkyMwOzsN5ZktImfhLA==',
        license: 'MIT',
        engines: {
          node: '>= 0.4',
        },
      },
      'node_modules/onnxruntime-common': {
        version: '1.30.0',
        resolved: 'https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.30.0.tgz',
        integrity:
          'sha512-7fdVWjAID1dVhH/G8qK3APARunV4VkBFoCQAP7qp4Wkab0mrorvmc+sqiT+mKXOzDqdjN5j+/Z9nb4gzNPWcyA==',
        license: 'MIT',
      },
      'node_modules/onnxruntime-node': {
        version: '1.30.0',
        resolved: 'https://registry.npmjs.org/onnxruntime-node/-/onnxruntime-node-1.30.0.tgz',
        integrity:
          'sha512-twhs1C2C/BFkz1yc5OY0KIU2GUq6DURO7hD4bx5Q2Qy3nAMJwRXW8xU3NVczE29VA9lolLOYepoD8fjTGOfIqw==',
        hasInstallScript: true,
        license: 'MIT',
        os: ['win32', 'darwin', 'linux'],
        dependencies: {
          'adm-zip': '^0.6.0',
          'global-agent': '^4.1.3',
          'onnxruntime-common': '1.30.0',
        },
      },
      'node_modules/onnxruntime-web': {
        version: '1.31.0-dev.20260914-8d85527a0',
        resolved:
          'https://registry.npmjs.org/onnxruntime-web/-/onnxruntime-web-1.31.0-dev.20260914-8d85527a0.tgz',
        integrity:
          'sha512-Iy7rtadoBgxS/LLvDr3QW38DB1PNXRnr0GJMcL0TAt7c9qjgVQl83UlGCVyeAnK2InpmW8Uc3PL8XIuqtDeF6g==',
        license: 'MIT',
        dependencies: {
          flatbuffers: '^25.1.24',
          'guid-typescript': '^1.0.9',
          long: '^5.2.3',
          'onnxruntime-common': '1.31.0-dev.20260911-2a43ec07e',
          platform: '^1.3.6',
          protobufjs: '^7.2.4',
        },
      },
      'node_modules/onnxruntime-web/node_modules/onnxruntime-common': {
        version: '1.31.0-dev.20260911-2a43ec07e',
        resolved:
          'https://registry.npmjs.org/onnxruntime-common/-/onnxruntime-common-1.31.0-dev.20260911-2a43ec07e.tgz',
        integrity:
          'sha512-gBuF6U32YErKIAt+yD7DeGBpjRxhJ1uJwako6ygjokSZULDU6Pd+KWComX8Tumk1hYVHRxjPj7mdMnD0ryAPOw==',
        license: 'MIT',
      },
      'node_modules/platform': {
        version: '1.3.6',
        resolved: 'https://registry.npmjs.org/platform/-/platform-1.3.6.tgz',
        integrity:
          'sha512-fnWVljUchTro6RiCFvCXBbNhJc2NijN7oIQxbwsyL0buWJPG85v81ehlHI9fXrJsMNgTofEoWIQeClKpgxFLrg==',
        license: 'MIT',
      },
      'node_modules/protobufjs': {
        version: '7.6.6',
        resolved: 'https://registry.npmjs.org/protobufjs/-/protobufjs-7.6.6.tgz',
        integrity:
          'sha512-dYDWdjSl5RNb7SgPxGQcRU+GtvP7s2fpkrY0r432PcOIaZ0/rBcxEZnQN67iJhFuQiVw754JDoPruPCNdGsbjg==',
        hasInstallScript: true,
        license: 'BSD-3-Clause',
        dependencies: {
          '@protobufjs/aspromise': '^1.1.2',
          '@protobufjs/base64': '^1.1.2',
          '@protobufjs/codegen': '^2.0.5',
          '@protobufjs/eventemitter': '^1.1.1',
          '@protobufjs/fetch': '^1.1.1',
          '@protobufjs/float': '^1.0.2',
          '@protobufjs/path': '^1.1.2',
          '@protobufjs/pool': '^1.1.0',
          '@protobufjs/utf8': '^1.1.1',
          '@types/node': '>=13.7.0',
          long: '^5.3.2',
        },
        engines: {
          node: '>=12.0.0',
        },
      },
      'node_modules/semver': {
        version: '7.8.6',
        resolved: 'https://registry.npmjs.org/semver/-/semver-7.8.6.tgz',
        integrity:
          'sha512-9lpSSU4Mly3mrtruwLs1eLK6+gzbzqeBFwRNjIjE+9LuDpWdYctrQlQ3ej1Ilgi7gknpsTRnPoLP8DpCHqHIJw==',
        license: 'ISC',
        bin: {
          semver: 'bin/semver.js',
        },
        engines: {
          node: '>=10',
        },
      },
      'node_modules/serialize-error': {
        version: '8.1.0',
        resolved: 'https://registry.npmjs.org/serialize-error/-/serialize-error-8.1.0.tgz',
        integrity:
          'sha512-3NnuWfM6vBYoy5gZFvHiYsVbafvI9vZv/+jlIigFn4oP4zjNPK3LhcY0xSCgeb1a5L8jO71Mit9LlNoi2UfDDQ==',
        license: 'MIT',
        dependencies: {
          'type-fest': '^0.20.2',
        },
        engines: {
          node: '>=10',
        },
      },
      'node_modules/sharp': {
        version: '0.35.5',
        resolved: 'https://registry.npmjs.org/sharp/-/sharp-0.35.5.tgz',
        integrity:
          'sha512-Ywn4OnzGukp7CDMrp08RQ50YKmuwG47brZgIVPTvBaaAfQlRlygrRqSrxdCiL9M+LlzLBiJ68IR1QqvzHyjC7g==',
        license: 'Apache-2.0',
        dependencies: {
          '@img/colour': '^1.1.0',
          'detect-libc': '^2.1.2',
          semver: '^7.8.5',
        },
        engines: {
          node: '>=20.9.0',
        },
        optionalDependencies: {
          '@img/sharp-darwin-arm64': '0.35.5',
          '@img/sharp-darwin-x64': '0.35.5',
          '@img/sharp-freebsd-wasm32': '0.35.5',
          '@img/sharp-libvips-darwin-arm64': '1.3.4',
          '@img/sharp-libvips-darwin-x64': '1.3.4',
          '@img/sharp-libvips-linux-arm': '1.3.4',
          '@img/sharp-libvips-linux-arm64': '1.3.4',
          '@img/sharp-libvips-linux-ppc64': '1.3.4',
          '@img/sharp-libvips-linux-riscv64': '1.3.4',
          '@img/sharp-libvips-linux-s390x': '1.3.4',
          '@img/sharp-libvips-linux-x64': '1.3.4',
          '@img/sharp-libvips-linuxmusl-arm64': '1.3.4',
          '@img/sharp-libvips-linuxmusl-x64': '1.3.4',
          '@img/sharp-linux-arm': '0.35.5',
          '@img/sharp-linux-arm64': '0.35.5',
          '@img/sharp-linux-ppc64': '0.35.5',
          '@img/sharp-linux-riscv64': '0.35.5',
          '@img/sharp-linux-s390x': '0.35.5',
          '@img/sharp-linux-x64': '0.35.5',
          '@img/sharp-linuxmusl-arm64': '0.35.5',
          '@img/sharp-linuxmusl-x64': '0.35.5',
          '@img/sharp-webcontainers-wasm32': '0.35.5',
          '@img/sharp-win32-arm64': '0.35.5',
          '@img/sharp-win32-ia32': '0.35.5',
          '@img/sharp-win32-x64': '0.35.5',
        },
        peerDependenciesMeta: {
          '@types/node': {
            optional: true,
          },
        },
      },
      'node_modules/tslib': {
        version: '2.9.1',
        resolved: 'https://registry.npmjs.org/tslib/-/tslib-2.9.1.tgz',
        integrity:
          'sha512-a4Ux9VKuIMHsOS7ENbEq6hK2ZGYIT27Rtl0E4eD9KqwxhKiQeMZE/9xb3IdYwWaSOyIBQLExhQgXDTYoiCxnWA==',
        license: '0BSD',
        optional: true,
      },
      'node_modules/type-fest': {
        version: '0.20.2',
        resolved: 'https://registry.npmjs.org/type-fest/-/type-fest-0.20.2.tgz',
        integrity:
          'sha512-Ne+eE4r0/iWnpAxD852z3A+N0Bt5RN//NjJwRd2VFHEmrywxf5vsZlh4R6lixl6B+wz/8d+maTSAkN1FIkI3LQ==',
        license: '(MIT OR CC0-1.0)',
        engines: {
          node: '>=10',
        },
      },
      'node_modules/undici-types': {
        version: '8.9.0',
        resolved: 'https://registry.npmjs.org/undici-types/-/undici-types-8.9.0.tgz',
        integrity:
          'sha512-KTDyRTYX8sWmKXAikPHHSyc63CRPETMctyjKFupcC6OBLXT3xsN0e9aF7m+mIXutFWpUXuedtowG7iLOzp0kQg==',
        license: 'MIT',
      },
    },
  },
} as const satisfies Record<OptionalDependencyName, unknown>;

/** SHA-256 of one file inside an installed package. */
export interface PinnedFile {
  /** Relative to the package's directory. */
  file: string;
  sha256: string;
}

/** What monomind loads or runs from one optional dependency. */
export interface CodePins {
  /** The version these hashes belong to. */
  version: string;
  /** The file ensureOptionalDependency() imports. */
  entry: PinnedFile;
  /** Every other file of the package the entry can load (relative imports). */
  modules?: PinnedFile[];
  /** Native binaries the package spawns, by the platform package that
   *  carries each one. */
  binaries?: Record<string, PinnedFile>;
}

/**
 * #526: SHA-256 of the code monomind loads from the trees above, checked
 * once per process before the entry is imported and before the SDK can
 * spawn its Claude binary (optional-deps-verify.ts). assertTrustedTree tells
 * a foreign or group-writable tree from monomind's own, but not a tree
 * planted by this same user; a planted file fails here. sdk.mjs is one
 * bundle that imports only Node built-ins, so it and the platform binary
 * are all the SDK runs. monofence-ai has no dependencies: its entry and
 * the 15 other dist/*.js files it can import are all it runs. What is not pinned is listed, with the reason, in
 * OPTIONAL_DEPENDENCIES_UNPINNED.
 *
 * Regenerate together with the lockfile, from the registry tarballs it
 * names. For the SDK and each of its platform packages:
 *   curl -sSLO <its "resolved" URL above>
 *   echo "sha512-$(openssl dgst -sha512 -binary <tgz> | base64 -w0)"  # must equal its "integrity"
 *   tar -xOzf <tgz> package/sdk.mjs | sha256sum   # the SDK's entry
 *   tar -xOzf <tgz> package/claude | sha256sum    # package/claude.exe for win32-*
 * and for monofence-ai, each dist/*.js file of its tarball:
 *   tar -xzf <tgz> && (cd package && find dist -name '*.js' | xargs sha256sum)
 * optional-deps-pins.test.ts checks these stay in step with the pins in
 * optional-deps.ts and with the lockfile above.
 */
export const OPTIONAL_DEPENDENCY_CODE_PINS: Partial<Record<string, CodePins>> = {
  '@anthropic-ai/claude-agent-sdk': {
    version: '0.3.319',
    entry: {
      file: 'sdk.mjs',
      sha256: '71460e29f72859dbc65a613e3737c834b4afa4b6411716fd7b596f9c5e129b76',
    },
    binaries: {
      '@anthropic-ai/claude-agent-sdk-darwin-arm64': {
        file: 'claude',
        sha256: '1f53587e92dee8e089fa349188a4cda64fa34ace6e7b0ca2ee278ddaa3cc2ebd',
      },
      '@anthropic-ai/claude-agent-sdk-darwin-x64': {
        file: 'claude',
        sha256: 'af6f1f5510ae98d56a155bf8f007aa9d5b44efccc9c10c8e10ef35039e95a940',
      },
      '@anthropic-ai/claude-agent-sdk-linux-arm64': {
        file: 'claude',
        sha256: 'a7e687fd1cb054d651c7588223de3786c99d4c682365e3c3ae1e59ce7f3a591f',
      },
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl': {
        file: 'claude',
        sha256: '244e1aaedb73cb73571c2d5f2380f7ad251ba7e010d2747a203d631a1e7bd2e8',
      },
      '@anthropic-ai/claude-agent-sdk-linux-x64': {
        file: 'claude',
        sha256: 'dabafec82ca1319fa43d8be36a10fc61b1d11821cb98ad5df04ad95e199b8eed',
      },
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl': {
        file: 'claude',
        sha256: 'b0f74e3c97fc4df46101bc7bcd0054d0f63733261cd63e5a0413cd50d66197f2',
      },
      '@anthropic-ai/claude-agent-sdk-win32-arm64': {
        file: 'claude.exe',
        sha256: '59b1ace11fad7f95c17a4ba01cf50eb48af20cd133df93129b34aa8e633bd6b1',
      },
      '@anthropic-ai/claude-agent-sdk-win32-x64': {
        file: 'claude.exe',
        sha256: '2e055732c9d03d22700d9046251a8370b673607bfcc9e4d16a1b0e8fb1345cbd',
      },
    },
  },
  '@huggingface/transformers': {
    version: '4.3.0',
    entry: {
      file: 'dist/transformers.node.cjs',
      sha256: 'cb1ded8e49422a53cf70fe6abb6b73d8f6df9ec952492f309e84502c4bd12458',
    },
  },
  'monofence-ai': {
    version: '2.24.0',
    entry: {
      file: 'dist/index.js',
      sha256: '9d70a9308b912e568f3de2114c5842f734d7bc7cff3b1fec12471b80ddf51a3b',
    },
    modules: [
      {
        file: 'dist/consensus.js',
        sha256: 'a9f1a6518d3450bc3c2ebf86d506c4368eb39444dd804d866dd37c20c729d8c0',
      },
      {
        file: 'dist/domain/entities/index.js',
        sha256: 'ed485c74b616f0b06cdaeb16346e8bb1bbe4f1cc51e62ee3621e4caa6435efe6',
      },
      {
        file: 'dist/domain/entities/threat.js',
        sha256: 'ed3c2667487e4ecb0c6fdb667b1b08197627375cc472489bd43aaf99ca9335cc',
      },
      {
        file: 'dist/domain/services/allowlist.js',
        sha256: '8d8336b301a2bfaef3b152a44b73e5449841c2c43e7d4b5eb7675bea6b516671',
      },
      {
        file: 'dist/domain/services/context-tracker.js',
        sha256: '071f2fb9ae00b55f2e3ec7b4e7981b18fdb9e378a92473b5b35252ea49f2d8e3',
      },
      {
        file: 'dist/domain/services/evasion-detector.js',
        sha256: '857c8189dac99e4bbe9699319dd166478105c79170123dd8274b8e775787273a',
      },
      {
        file: 'dist/domain/services/index.js',
        sha256: '3e2bdb4c3a7cc0aa7a8fa9f0319bfa7f92d2f87f87f696fc1d2f92b6a325f597',
      },
      {
        file: 'dist/domain/services/output-scanner.js',
        sha256: 'eae307ae6df634c74a66859fc8d806afb7a0f9d00ac41dbbe1011cf59fd661ae',
      },
      {
        file: 'dist/domain/services/threat-detection-service.js',
        sha256: 'cdd3dd10e6ababd13853e488479a48e6ba1d0cee8886edd3cdcff5ef3a593135',
      },
      {
        file: 'dist/domain/services/threat-learning-inmemory-store.js',
        sha256: '0c19f2bf5f26cfbddeb9acaecf2493c76d799e8723cc590ed8c3c4c576e297e1',
      },
      {
        file: 'dist/domain/services/threat-learning-service.js',
        sha256: '9c95a61f6ea061234816f42350e8756e11f314993ed79a3f6b0902fb630e2885',
      },
      {
        file: 'dist/domain/services/threat-patterns.js',
        sha256: '6d270b5fc1be3cc3dea23160279698396dc46175610da5c6ebe3826993f977ec',
      },
      {
        file: 'dist/facade.js',
        sha256: '7f7fdbcc06f0a3410ad3169ae4f7c62ced3e491f54898f0a61aa48291d48e653',
      },
      {
        file: 'dist/hooks/security-hook.js',
        sha256: '91211476d372801b4b4e205097e11b4822d56bd11769ea8f3f5858ed1b7f86ce',
      },
      {
        file: 'dist/singleton.js',
        sha256: '4a39cc92ec0d087ccef7f07ecd86989734e18399fbbb1511354ae31d00b8f805',
      },
    ],
  },
};

/** Optional dependencies loaded without code pins, each with the reason.
 *  optional-deps-pins.test.ts fails for one that is in neither list. */
export const OPTIONAL_DEPENDENCIES_UNPINNED: Record<string, string> = {
  '@puppeteer/browsers':
    'it loads its own dependency tree (about 30 packages) rather than one bundle, and only ' +
    'downloads Chrome; the lockfile integrity and assertTrustedTree still apply',
};
