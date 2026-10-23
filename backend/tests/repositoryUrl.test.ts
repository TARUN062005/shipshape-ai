import { describe, expect, it } from "vitest";
import { RepositoryUrlError, parseRepositoryUrl } from "../src/validation/repositoryUrl.js";

describe("parseRepositoryUrl", () => {
  it("accepts a canonical repository URL and ignores the query", () => {
    expect(parseRepositoryUrl("https://github.com/expressjs/express?tab=readme")).toEqual({
      owner: "expressjs",
      repo: "express",
      url: "https://github.com/expressjs/express",
    });
  });

  it("accepts www, a trailing slash, and a .git suffix", () => {
    expect(parseRepositoryUrl("https://www.github.com/ExpressJS/Express.git/")).toEqual({
      owner: "ExpressJS",
      repo: "Express",
      url: "https://github.com/ExpressJS/Express",
    });
  });

  it("accepts the longest GitHub owner and repository names", () => {
    const owner = `a${"b".repeat(37)}c`;
    const repo = `r${"e".repeat(98)}p`;
    expect(owner).toHaveLength(39);
    expect(repo).toHaveLength(100);
    expect(parseRepositoryUrl(`https://github.com/${owner}/${repo}`).owner).toBe(owner);
  });

  it.each([
    "",
    "   ",
    "github.com/owner/repo",
    "http://github.com/owner/repo",
    "https://user:pass@github.com/owner/repo",
    "https://github.com:444/owner/repo",
    "https://localhost/owner/repo",
    "https://127.0.0.1/owner/repo",
    "https://[::1]/owner/repo",
    "https://169.254.169.254/latest/meta-data",
    "https://github.com.evil.com/owner/repo",
    "https://api.github.com/repos/owner/repo",
    "https://gist.github.com/owner/repo",
    "https://raw.githubusercontent.com/owner/repo/main/package.json",
    "https://evil.com\\@github.com/owner/repo",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "git@github.com:owner/repo",
    "https://github.com/owner",
    "https://github.com/owner/repo/tree/main",
    "https://github.com/owner/repo/blob/main/README.md",
    "https://github.com//owner/repo",
    "https://github.com/foo%2Fbar/baz",
    "https://github.com/owner/repo%2F..%2Fsecret",
    `https://github.com/${"a".repeat(40)}/repo`,
    `https://github.com/owner/${"r".repeat(101)}`,
    "https://github.com/-owner/repo",
    "https://github.com/owner/.git",
  ])("rejects %s", (input) => {
    expect(() => parseRepositoryUrl(input)).toThrow(RepositoryUrlError);
  });
});
