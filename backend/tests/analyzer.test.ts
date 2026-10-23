import { describe, expect, it } from "vitest";
import { analyzeSnapshot } from "../src/analyzer/analyze.js";
import { summarizeFindings } from "../src/analyzer/summarize.js";
import type { Finding, Status } from "../src/types.js";
import { makeSnapshot, perfectNode } from "./fixtures.js";

function statuses(snapshot: ReturnType<typeof makeSnapshot>): Record<string, Status> {
  const report = analyzeSnapshot(snapshot);
  return Object.fromEntries(report.findings.map((finding) => [finding.id, finding.status]));
}

function expectCitedPaths(snapshot: ReturnType<typeof makeSnapshot>): void {
  const report = analyzeSnapshot(snapshot);
  for (const finding of report.findings) {
    for (const filePath of finding.paths) {
      expect(snapshot.paths).toContain(filePath);
    }
  }
}

describe("analyzeSnapshot", () => {
  it("passes a complete Node.js repository and leaves branch protection unchecked", () => {
    const snapshot = perfectNode();
    const report = analyzeSnapshot(snapshot);
    expect(report.projectTypes).toEqual(["node"]);
    expect(statuses(snapshot)).toMatchObject({
      "tree-completeness": "PASS",
      archived: "PASS",
      readme: "PASS",
      license: "PASS",
      gitignore: "PASS",
      "continuous-integration": "PASS",
      "dependency-manifest": "PASS",
      lockfile: "PASS",
      "automated-tests": "PASS",
      "node-modules": "PASS",
      "env-hygiene": "PASS",
      "dependency-updates": "PASS",
      changelog: "PASS",
      "security-policy": "PASS",
      "github-release": "PASS",
      "branch-protection": "NOT_CHECKED",
    });
    expect(report.summary.status).toBe("PASS");
    expect(report.summary.score).toBe(100);
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.evidence).toContain("Tests were not executed.");
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.evidence).toContain("vitest run");
    expect(report.findings.find((finding) => finding.id === "branch-protection")?.evidence).toContain("admin");
    expect(JSON.stringify(report)).not.toContain("SUPER_SECRET_SENTINEL_9f3a");
    expectCitedPaths(snapshot);
  });

  it("fails a Node.js repository that is missing release signals", () => {
    const snapshot = makeSnapshot({
      license: null,
      latestRelease: null,
      paths: ["package.json"],
      texts: { "package.json": JSON.stringify({ name: "widget", scripts: {} }) },
    });
    expect(statuses(snapshot)).toMatchObject({
      readme: "FAIL",
      license: "FAIL",
      gitignore: "FAIL",
      "continuous-integration": "FAIL",
      "dependency-manifest": "PASS",
      lockfile: "FAIL",
      "automated-tests": "FAIL",
      "node-modules": "PASS",
      "env-hygiene": "NEEDS_REVIEW",
      "dependency-updates": "NEEDS_REVIEW",
      changelog: "NEEDS_REVIEW",
      "security-policy": "NEEDS_REVIEW",
      "github-release": "NEEDS_REVIEW",
      "branch-protection": "NOT_CHECKED",
    });
    expect(analyzeSnapshot(snapshot).summary.status).toBe("FAIL");
    expectCitedPaths(snapshot);
  });

  it("does not treat a truncated tree as confirmed missing files", () => {
    const snapshot = makeSnapshot({
      treeTruncated: true,
      paths: ["README.md"],
    });
    const report = analyzeSnapshot(snapshot);
    expect(report.findings.some((finding) => finding.status === "FAIL")).toBe(false);
    expect(report.findings.find((finding) => finding.id === "tree-completeness")?.status).toBe("NEEDS_REVIEW");
    expect(report.findings.find((finding) => finding.id === "readme")?.status).toBe("PASS");
    expect(report.findings.find((finding) => finding.id === "license")?.status).toBe("PASS");
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("NEEDS_REVIEW");
    expect(report.summary.status).toBe("NEEDS_REVIEW");
  });

  it("fails a confirmed missing README and leaves unknown ecosystems unchecked", () => {
    const snapshot = makeSnapshot({
      license: null,
      latestRelease: null,
      paths: ["notes.txt"],
    });
    const report = analyzeSnapshot(snapshot);
    expect(report.projectTypes).toEqual([]);
    expect(report.findings.find((finding) => finding.id === "readme")?.status).toBe("FAIL");
    expect(report.findings.find((finding) => finding.id === "lockfile")?.status).toBe("NOT_CHECKED");
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("NOT_CHECKED");
    expect(report.summary.status).toBe("FAIL");
  });

  it("does not echo committed secret file contents", () => {
    const snapshot = perfectNode();
    snapshot.paths = [...snapshot.paths, ".env", "id_rsa"];
    snapshot.texts[".env"] = "AWS_SECRET_ACCESS_KEY=trapvalue123";
    const report = analyzeSnapshot(snapshot);
    const hygiene = report.findings.find((finding) => finding.id === "env-hygiene");
    expect(hygiene?.status).toBe("FAIL");
    expect(hygiene?.severity).toBe("high");
    expect(hygiene?.evidence).toContain("does not read");
    expect(JSON.stringify(report)).not.toContain("trapvalue123");
    expect(JSON.stringify(report)).not.toContain("AWS_SECRET_ACCESS_KEY");
    expect(report.summary.status).toBe("FAIL");
  });

  it("reviews PEM files without reading them", () => {
    const snapshot = perfectNode();
    snapshot.paths = [...snapshot.paths, "certs/server.pem"];
    const hygiene = analyzeSnapshot(snapshot).findings.find((finding) => finding.id === "env-hygiene");
    expect(hygiene?.status).toBe("NEEDS_REVIEW");
    expect(hygiene?.evidence).toContain("were not read");
  });

  it("passes a Poetry project with pytest files", () => {
    const snapshot = makeSnapshot({
      language: "Python",
      paths: [
        "README.md",
        "LICENSE",
        ".gitignore",
        "pyproject.toml",
        "poetry.lock",
        "tests/test_widget.py",
        ".github/workflows/ci.yml",
        ".github/dependabot.yml",
        "CHANGELOG.md",
        "SECURITY.md",
      ],
      texts: {
        "pyproject.toml": "[tool.poetry]\nname = \"widget\"\n\n[tool.pytest.ini_options]\nminversion = \"7.0\"\n",
        ".gitignore": ".env\n",
      },
    });
    const report = analyzeSnapshot(snapshot);
    expect(report.projectTypes).toEqual(["python"]);
    expect(report.summary.status).toBe("PASS");
    expect(report.findings.find((finding) => finding.id === "node-modules")?.status).toBe("NOT_CHECKED");
    expect(report.findings.find((finding) => finding.id === "lockfile")?.status).toBe("PASS");
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("PASS");
  });

  it("recognizes Go, Rust, and Java signals", () => {
    const go = analyzeSnapshot(makeSnapshot({
      paths: ["go.mod", "go.sum", "main.go", "main_test.go", "README.md"],
    }));
    expect(go.projectTypes).toEqual(["go"]);
    expect(go.findings.find((finding) => finding.id === "lockfile")?.status).toBe("PASS");
    expect(go.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("PASS");

    const rust = analyzeSnapshot(makeSnapshot({
      paths: ["Cargo.toml", "src/main.rs", "README.md"],
    }));
    expect(rust.findings.find((finding) => finding.id === "lockfile")?.status).toBe("NEEDS_REVIEW");
    expect(rust.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("NEEDS_REVIEW");

    const java = analyzeSnapshot(makeSnapshot({
      paths: ["pom.xml", "src/main/java/App.java", "README.md"],
      license: null,
    }));
    expect(java.projectTypes).toEqual(["java"]);
    expect(java.findings.find((finding) => finding.id === "lockfile")?.status).toBe("NOT_CHECKED");
    expect(java.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("FAIL");
    expect(java.findings.some((finding) => finding.id === "java-dependency-pinning")).toBe(false);
  });

  it("keeps a separate not-checked finding for Java when another ecosystem is judged", () => {
    const report = analyzeSnapshot(makeSnapshot({
      paths: ["package.json", "package-lock.json", "pom.xml", "src/test/java/AppTest.java"],
      texts: { "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) },
    }));
    expect(report.projectTypes).toEqual(["node", "java"]);
    expect(report.findings.find((finding) => finding.id === "lockfile")?.status).toBe("PASS");
    expect(report.findings.find((finding) => finding.id === "java-dependency-pinning")?.status).toBe("NOT_CHECKED");
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("PASS");
  });

  it("fails a placeholder npm test and reviews one that has a config file", () => {
    const placeholder = analyzeSnapshot(makeSnapshot({
      paths: ["package.json"],
      texts: { "package.json": JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } }) },
    }));
    expect(placeholder.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("FAIL");

    const configured = analyzeSnapshot(makeSnapshot({
      paths: ["package.json", "vitest.config.ts"],
      texts: { "package.json": JSON.stringify({ scripts: { test: "echo \"Error: no test specified\" && exit 1" } }) },
    }));
    expect(configured.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("NEEDS_REVIEW");
  });

  it("does not fail tests when package.json cannot be parsed", () => {
    const report = analyzeSnapshot(makeSnapshot({
      paths: ["package.json"],
      texts: { "package.json": "{" },
    }));
    expect(report.findings.find((finding) => finding.id === "automated-tests")?.status).toBe("NEEDS_REVIEW");
  });

  it("reviews a gitignore negation and committed node_modules", () => {
    const report = analyzeSnapshot(makeSnapshot({
      paths: [".gitignore", "node_modules/leftpad/index.js", "package.json"],
      texts: { ".gitignore": "!.env\n", "package.json": JSON.stringify({ scripts: { test: "vitest run" } }) },
    }));
    expect(report.findings.find((finding) => finding.id === "env-hygiene")?.status).toBe("NEEDS_REVIEW");
    expect(report.findings.find((finding) => finding.id === "node-modules")?.status).toBe("FAIL");
  });
});

describe("summarizeFindings", () => {
  function finding(status: Finding["status"], severity: Finding["severity"]): Finding {
    return {
      id: `${status}-${severity}`,
      title: "Example",
      category: "repository",
      severity,
      status,
      summary: "Example",
      evidence: "Example",
      paths: [],
    };
  }

  it("passes when the only non-pass item was not checked", () => {
    expect(summarizeFindings([finding("PASS", "info"), finding("NOT_CHECKED", "info")]).status).toBe("PASS");
  });

  it("holds the report for a low failure or a review item", () => {
    expect(summarizeFindings([finding("PASS", "info"), finding("FAIL", "low")]).status).toBe("NEEDS_REVIEW");
    expect(summarizeFindings([finding("PASS", "info"), finding("NEEDS_REVIEW", "low")]).status).toBe("NEEDS_REVIEW");
  });

  it("fails the report for a medium or higher failure", () => {
    expect(summarizeFindings([finding("FAIL", "medium"), finding("PASS", "info")]).status).toBe("FAIL");
    expect(summarizeFindings([finding("FAIL", "high")]).status).toBe("FAIL");
  });

  it("does not call an empty check list a pass", () => {
    expect(summarizeFindings([]).status).toBe("NEEDS_REVIEW");
    expect(summarizeFindings([]).score).toBe(0);
  });
});
