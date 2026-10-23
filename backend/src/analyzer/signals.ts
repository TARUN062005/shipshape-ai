import type { RepoSnapshot } from "../types.js";

export function listIncomplete(snapshot: RepoSnapshot): boolean {
  return snapshot.treeTruncated || snapshot.ignoredPathCount > 0;
}

export function readJsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text.replace(/^\uFEFF/, ""));
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function quoteScript(script: string): string {
  return script.replace(/[\u0000-\u001F\u007F]/g, " ").trim().slice(0, 160);
}

export function isPlaceholderTestScript(script: string): boolean {
  const normalized = script.trim().toLowerCase().replace(/\s+/g, " ");
  if (!normalized) return true;
  if (normalized.includes("no test specified")) return true;
  return ["true", "false", ":", "noop", "exit 0", "exit 1", "exit"].includes(normalized);
}

const EXAMPLE_ENV = new Set([".env.example", ".env.sample", ".env.template"]);
const PRIVATE_KEYS = new Set(["id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"]);

export function isSecretFilename(name: string): boolean {
  const lower = name.toLowerCase();
  if (EXAMPLE_ENV.has(lower)) return false;
  if (
    lower === ".env" ||
    lower === ".env.local" ||
    lower === ".env.production" ||
    lower === ".env.development"
  ) {
    return true;
  }
  if (
    lower.startsWith(".env.") &&
    lower.endsWith(".local") &&
    !lower.includes("example") &&
    !lower.includes("sample") &&
    !lower.includes("template")
  ) {
    return true;
  }
  return PRIVATE_KEYS.has(lower);
}

export function isNodeTestConfig(name: string): boolean {
  return /^(vitest|jest|playwright|cypress|ava)\.config\.[cm]?[jt]sx?$/.test(name) ||
    name === "jest.config.json" ||
    name === ".mocharc.js" ||
    name === ".mocharc.cjs" ||
    name === ".mocharc.json" ||
    name === ".mocharc.yml" ||
    name === ".mocharc.yaml";
}

export function isNodeTestFile(name: string): boolean {
  return /\.(test|spec)\.[cm]?[jt]sx?$/.test(name);
}

export function isCiPath(path: string): boolean {
  if (path.startsWith(".github/workflows/") && (path.endsWith(".yml") || path.endsWith(".yaml"))) return true;
  return (
    path === ".gitlab-ci.yml" ||
    path === "azure-pipelines.yml" ||
    path === "Jenkinsfile" ||
    path === ".circleci/config.yml" ||
    path === "bitbucket-pipelines.yml"
  );
}

export function isReadmePath(path: string): boolean {
  return /^readme(\.(md|markdown|rst|txt|adoc))?$/i.test(path);
}

export function isLicensePath(path: string): boolean {
  return /^(license|licence|copying|unlicense)(\.(md|txt))?$/i.test(path);
}

export function isChangelogPath(path: string): boolean {
  return /^(changelog|changes|history)(\.(md|rst|txt))?$/i.test(path);
}

const NODE_LOCKS = new Set([
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
]);

export function isNodeLock(name: string): boolean {
  return NODE_LOCKS.has(name);
}
