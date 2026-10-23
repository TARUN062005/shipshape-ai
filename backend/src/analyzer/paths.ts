import { isSafeRepoPath } from "../safety/repoPath.js";

const SKIP_DIRS = new Set([
  "node_modules",
  "vendor",
  "venv",
  ".venv",
  "dist",
  "build",
  "site-packages",
  "target",
  ".git",
  "coverage",
]);

export function basename(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function isRootPath(path: string): boolean {
  return isSafeRepoPath(path) && !path.includes("/");
}

/** Paths that describe the project rather than installed or generated output. */
export function isProjectPath(path: string): boolean {
  if (!isSafeRepoPath(path)) return false;
  return path.split("/").every((segment) => !SKIP_DIRS.has(segment));
}

export function joinPaths(paths: string[], max = 8): { listed: string[]; text: string } {
  const unique: string[] = [];
  for (const path of paths) {
    if (!unique.includes(path)) unique.push(path);
  }
  const listed = unique.slice(0, max);
  const extra = unique.length - listed.length;
  const text = extra > 0 ? `${listed.join(", ")} and ${extra} more` : listed.join(", ");
  return { listed, text };
}
