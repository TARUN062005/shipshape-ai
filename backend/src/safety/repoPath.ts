/**
 * Accept a GitHub tree path that cannot escape the repository when we later
 * join it onto an API URL. This does not mean the file is safe to execute.
 */
export function isSafeRepoPath(path: string): boolean {
  if (typeof path !== "string") return false;
  if (path.length === 0 || path.length > 500) return false;
  if (path.startsWith("/") || path.endsWith("/")) return false;
  // Percent, question mark, and hash can appear in real filenames. Callers encode
  // each segment before building an API URL, so these are not treated as escapes.
  if (/[\\\0\r\n\t]/.test(path)) return false;
  const parts = path.split("/");
  return parts.every((part) => part.length > 0 && part !== "." && part !== ".." && part.trim().length > 0);
}
