import { describe, expect, it } from "vitest";
import { isProjectPath } from "../src/analyzer/paths.js";
import { isSafeRepoPath } from "../src/safety/repoPath.js";

describe("repository paths", () => {
  it("keeps ordinary project files and drops traversal", () => {
    expect(isSafeRepoPath("README.md")).toBe(true);
    expect(isSafeRepoPath("src/tests/app.test.ts")).toBe(true);
    expect(isSafeRepoPath("test/fixtures/% of dogs.txt")).toBe(true);
    expect(isSafeRepoPath(".env")).toBe(true);
    expect(isSafeRepoPath("../.env")).toBe(false);
    expect(isSafeRepoPath("/etc/passwd")).toBe(false);
    expect(isSafeRepoPath("a/../../b")).toBe(false);
    expect(isSafeRepoPath("foo\\bar")).toBe(false);
    expect(isSafeRepoPath("foo//bar")).toBe(false);
    expect(isSafeRepoPath("foo/./bar")).toBe(false);
    expect(isSafeRepoPath(`${"a".repeat(501)}`)).toBe(false);
  });

  it("ignores installed and generated directories for project detection", () => {
    expect(isProjectPath("package.json")).toBe(true);
    expect(isProjectPath("services/api/pyproject.toml")).toBe(true);
    expect(isProjectPath("node_modules/leftpad/package.json")).toBe(false);
    expect(isProjectPath("vendor/mod/go.sum")).toBe(false);
    expect(isProjectPath(".venv/lib/python.py")).toBe(false);
  });
});
