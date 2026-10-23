import type { RepoSnapshot } from "../src/types.js";

export function makeSnapshot(overrides: Partial<RepoSnapshot> = {}): RepoSnapshot {
  return {
    owner: "acme",
    repo: "widget",
    description: "Widget service",
    defaultBranch: "main",
    stars: 12,
    forks: 1,
    language: "TypeScript",
    license: "MIT",
    archived: false,
    pushedAt: "2026-10-01T00:00:00Z",
    openIssues: 0,
    latestRelease: { tag: "v1.2.0", name: "1.2.0", prerelease: false },
    releaseLookup: "ok",
    treeTruncated: false,
    ignoredPathCount: 0,
    paths: [],
    texts: {},
    omittedTexts: [],
    ...overrides,
  };
}

export function perfectNode(): RepoSnapshot {
  return makeSnapshot({
    paths: [
      "README.md",
      "LICENSE",
      ".gitignore",
      "package.json",
      "package-lock.json",
      "vitest.config.ts",
      ".env.example",
      ".github/workflows/ci.yml",
      ".github/dependabot.yml",
      "CHANGELOG.md",
      "SECURITY.md",
      "src/index.ts",
      "tests/app.test.ts",
    ],
    texts: {
      "package.json": JSON.stringify({
        name: "widget",
        version: "1.0.0",
        scripts: { test: "vitest run" },
        secretMarker: "SUPER_SECRET_SENTINEL_9f3a",
      }),
      ".gitignore": ".env\nnode_modules\n",
    },
  });
}
