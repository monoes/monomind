import path from "node:path";

export function isDeclarationFile(filePath: string): boolean {
  const name = path.basename(filePath);
  return name.endsWith(".d.ts") || name.endsWith(".d.mts") || name.endsWith(".d.cts");
}

export function isHtmlFile(filePath: string): boolean {
  return path.extname(filePath) === ".html";
}

export function isConfigFile(filePath: string): boolean {
  const name = path.basename(filePath);

  if (name.startsWith(".") && !name.startsWith("..")) {
    const lower = name.toLowerCase();
    if (lower.includes("rc.")) {
      return true;
    }
  }

  const configPatterns = [
    "babel.config.",
    "rollup.config.",
    "webpack.config.",
    "postcss.config.",
    "stencil.config.",
    "remotion.config.",
    "metro.config.",
    "tsup.config.",
    "unbuild.config.",
    "esbuild.config.",
    "swc.config.",
    "turbo.",
    "jest.config.",
    "jest.setup.",
    "vitest.config.",
    "vitest.ci.config.",
    "vitest.setup.",
    "vitest.workspace.",
    "playwright.config.",
    "cypress.config.",
    "karma.conf.",
    "eslint.config.",
    "prettier.config.",
    "stylelint.config.",
    "lint-staged.config.",
    "commitlint.config.",
    "next.config.",
    "next-sitemap.config.",
    "nuxt.config.",
    "astro.config.",
    "sanity.config.",
    "vite.config.",
    "tailwind.config.",
    "drizzle.config.",
    "knexfile.",
    "sentry.client.config.",
    "sentry.server.config.",
    "sentry.edge.config.",
    "react-router.config.",
    "typedoc.",
    "knip.config.",
    "fallow.config.",
    "i18next-parser.config.",
    "codegen.config.",
    "graphql.config.",
    "npmpackagejsonlint.config.",
    "release-it.",
    "release.config.",
    "contentlayer.config.",
    "next-env.d.",
    "env.d.",
    "vite-env.d.",
  ];

  return configPatterns.some((p) => name.startsWith(p));
}

export function isTestFile(filePath: string): boolean {
  return (
    filePath.includes("/__tests__/") ||
    filePath.includes("/.test.") ||
    filePath.includes(".test.") ||
    filePath.includes(".spec.")
  );
}
