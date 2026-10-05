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
          '@anthropic-ai/claude-agent-sdk': '0.3.289',
        },
      },
      'node_modules/@anthropic-ai/claude-agent-sdk': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk/-/claude-agent-sdk-0.3.289.tgz',
        integrity:
          'sha512-fQRvZPhf6zxyzj7gwyItbhixmu5+Oy0HMQOyzYz3Phjhxuhj3TnpGPPy0VBnbSqWqYxT67TAFOiF5OzOFMYPLQ==',
        license: 'SEE LICENSE IN README.md',
        engines: {
          node: '>=18.0.0',
        },
        optionalDependencies: {
          '@anthropic-ai/claude-agent-sdk-darwin-arm64': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-darwin-x64': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-linux-arm64': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-linux-arm64-musl': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-linux-x64': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-linux-x64-musl': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-win32-arm64': '0.3.289',
          '@anthropic-ai/claude-agent-sdk-win32-x64': '0.3.289',
        },
        peerDependencies: {
          '@anthropic-ai/sdk': '>=0.93.0',
          '@modelcontextprotocol/sdk': '^1.29.0',
          zod: '^4.0.0',
        },
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-arm64/-/claude-agent-sdk-darwin-arm64-0.3.289.tgz',
        integrity:
          'sha512-A1iK70JJgj6GhSkGnaVC02B1hX0aPvWTbn3a1Fp9iKhXt1a6eZwAhkqdP+F/rzAVUcQG24ehG/LBF2Ec8tBL0Q==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-darwin-x64/-/claude-agent-sdk-darwin-x64-0.3.289.tgz',
        integrity:
          'sha512-8kCv04+eOm26zPta8hym7eNHT/nn44a94Y/XwiR9ExWGGDcBJpNOZkVUxt+ciiKNQN7ujuYqAjdRedIRyD1izw==',
        cpu: ['x64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['darwin'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64/-/claude-agent-sdk-linux-arm64-0.3.289.tgz',
        integrity:
          'sha512-u5GKtkDU5ho9g8fveN4PgInHyWOBQ12wSlZAcssrQJx8WmoYTUYQTz5kH4e6VNYfIJv1K5DXOSxPGuqbcSMr6Q==',
        cpu: ['arm64'],
        libc: ['glibc'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64-musl': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-arm64-musl/-/claude-agent-sdk-linux-arm64-musl-0.3.289.tgz',
        integrity:
          'sha512-nA1iLmY9R1Da042RWEJbJxz2S+jMVk1KcACeAuW2A9vVBqAUZwHXwWG1tvs9OZOBzxtayOxvKfG1pGIjoyStww==',
        cpu: ['arm64'],
        libc: ['musl'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64/-/claude-agent-sdk-linux-x64-0.3.289.tgz',
        integrity:
          'sha512-d/2f7T/DpnEat78nun+mE26HZ0rO9BGEmoGja1i8iIW62IZX1K3T2IXd1h0Wjgtx1JSGDUK3pxMhQJxMyJdycQ==',
        cpu: ['x64'],
        libc: ['glibc'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64-musl': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-linux-x64-musl/-/claude-agent-sdk-linux-x64-musl-0.3.289.tgz',
        integrity:
          'sha512-/XpyF/cyWNABbgxvtR+v8xz8bjv1lCZKZfBKdm5b/ROlfmyr27Q37JqNUUY6HR9dGvSYf4tCzkqLstk2tQZ6UQ==',
        cpu: ['x64'],
        libc: ['musl'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['linux'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-arm64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-arm64/-/claude-agent-sdk-win32-arm64-0.3.289.tgz',
        integrity:
          'sha512-/99s03mf1X3YB8pqcAsF+yDBo/O6kzZG2A6UU8zAf5Xa0iM/aBgd6kCx5Qz2KozrCkrlnbsWjp3HKEKs0Ls7MA==',
        cpu: ['arm64'],
        license: 'SEE LICENSE IN LICENSE.md',
        optional: true,
        os: ['win32'],
      },
      'node_modules/@anthropic-ai/claude-agent-sdk-win32-x64': {
        version: '0.3.289',
        resolved:
          'https://registry.npmjs.org/@anthropic-ai/claude-agent-sdk-win32-x64/-/claude-agent-sdk-win32-x64-0.3.289.tgz',
        integrity:
          'sha512-HBoziJqI6LkEkqZuumOXxXLMZEvnZOQirc3OyZTDJIa7UJcV/pn9EsBXLruMlNztrOWfEqBeYArXSl00H91rjA==',
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
          'monofence-ai': '1.0.7',
        },
      },
      'node_modules/monofence-ai': {
        version: '1.0.7',
        resolved: 'https://registry.npmjs.org/monofence-ai/-/monofence-ai-1.0.7.tgz',
        integrity:
          'sha512-hFDDmO6G5Z0NwzcjUUdmZXywFc32lX2dUTkeIKZKrUBVB7YJargHAeSnIrNLBzgzoqs63wdjXmXuTyQV63V6lw==',
        license: 'Apache-2.0',
        engines: {
          node: '>=22.12.0',
        },
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
    version: '0.3.289',
    entry: {
      file: 'sdk.mjs',
      sha256: '14dd69730612135f9bd3a67793f291651d9d0ff4b8f05500963fe2a84fa0af1c',
    },
    binaries: {
      '@anthropic-ai/claude-agent-sdk-darwin-arm64': {
        file: 'claude',
        sha256: '03d66745e3bb69ec727d66023696f3820bc0a00a8a5ba725eb6706d0c67cbe69',
      },
      '@anthropic-ai/claude-agent-sdk-darwin-x64': {
        file: 'claude',
        sha256: '358aa0e31666c48b2340ad9fa4003436105086ca12e1ecd4c5266d18598c2f7f',
      },
      '@anthropic-ai/claude-agent-sdk-linux-arm64': {
        file: 'claude',
        sha256: 'd100d5e41dcbee220c80d3a3099292e4b5a508b57cafd181856efedf29f84f28',
      },
      '@anthropic-ai/claude-agent-sdk-linux-arm64-musl': {
        file: 'claude',
        sha256: 'e9dfa4a0df412a1204c6a5efe3964c0e9f36f05fd86ebec1d9c84abf333e7d65',
      },
      '@anthropic-ai/claude-agent-sdk-linux-x64': {
        file: 'claude',
        sha256: 'a186b99e4a9c88366cd49df2f7dad56c61fc306ef0140b19ee64b7c42a8d1348',
      },
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl': {
        file: 'claude',
        sha256: 'a35123e65344b82ab10870f5842cac7e593e4a56b1f6bddaed96bd9b9d42953d',
      },
      '@anthropic-ai/claude-agent-sdk-win32-arm64': {
        file: 'claude.exe',
        sha256: 'fc96c5a93fb84972332fd6fb55895829e55005106e3e5ad6d8153f1eb6762f91',
      },
      '@anthropic-ai/claude-agent-sdk-win32-x64': {
        file: 'claude.exe',
        sha256: 'bcc6d9117aec30ad9414490302a25414359c871f5647e32e49b055c92bf84e0b',
      },
    },
  },
  'monofence-ai': {
    version: '1.0.7',
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
