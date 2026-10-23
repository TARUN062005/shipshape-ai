import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const full = path.join(directory, entry);
    if (statSync(full).isDirectory()) return filesUnder(full);
    return [full];
  });
}

function source(directory: string): string {
  return filesUnder(directory)
    .filter((file) => /\.(ts|tsx|js|html|css)$/.test(file))
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
}

describe("trust boundaries", () => {
  it("does not execute repository code from the backend", () => {
    const backend = source(path.join(root, "backend", "src"));
    expect(backend).not.toContain("child_process");
    expect(backend).not.toContain("git clone");
    expect(backend).not.toContain("eval(");
  });

  it("keeps BharatCode and GitHub credentials out of the frontend", () => {
    const frontend = [
      source(path.join(root, "frontend", "src")),
      readFileSync(path.join(root, "frontend", "index.html"), "utf8"),
      readFileSync(path.join(root, "frontend", "vite.config.ts"), "utf8"),
    ].join("\n");
    expect(frontend).not.toContain("BHARATCODE_API_KEY");
    expect(frontend).not.toContain("GITHUB_TOKEN");
    expect(frontend).not.toContain("bharatcode.ai");
    expect(frontend).not.toContain("api.github.com");
    expect(frontend).not.toContain("child_process");
  });
});
