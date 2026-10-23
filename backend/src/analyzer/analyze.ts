/**
 * Deterministic release checks. This module never executes repository files.
 * A missing file fails a check only when the GitHub file list was complete.
 */
import type { Finding, ProjectType, RepoSnapshot, Severity, Status } from "../types.js";
import { detectProject } from "./detect.js";
import { basename, isProjectPath, isRootPath, joinPaths } from "./paths.js";
import { summarizeFindings } from "./summarize.js";
import {
  isChangelogPath,
  isCiPath,
  isLicensePath,
  isNodeLock,
  isNodeTestConfig,
  isNodeTestFile,
  isPlaceholderTestScript,
  isReadmePath,
  isSecretFilename,
  listIncomplete,
  quoteScript,
  readJsonObject,
} from "./signals.js";
import type { Analysis } from "../types.js";

interface Part {
  status: Status;
  evidence: string;
  paths: string[];
}

export function analyzeSnapshot(snapshot: RepoSnapshot): Analysis {
  const detection = detectProject(snapshot.paths);
  const findings = [
    treeCompleteness(snapshot),
    archived(snapshot),
    readme(snapshot),
    license(snapshot),
    gitignore(snapshot),
    continuousIntegration(snapshot),
    dependencyManifest(snapshot, detection.types, detection.manifests),
    lockfile(snapshot, detection.types),
    ...javaPinning(detection.types),
    automatedTests(snapshot, detection.types),
    nodeModules(snapshot, detection.types),
    envHygiene(snapshot),
    dependencyUpdates(snapshot),
    changelog(snapshot),
    securityPolicy(snapshot),
    githubRelease(snapshot),
    branchProtection(),
  ];

  return {
    projectTypes: detection.types,
    findings,
    summary: summarizeFindings(findings),
  };
}

function treeCompleteness(snapshot: RepoSnapshot): Finding {
  const base = {
    id: "tree-completeness",
    title: "File list completeness",
    category: "repository" as const,
    paths: [] as string[],
  };
  if (!listIncomplete(snapshot)) {
    return {
      ...base,
      severity: "info",
      status: "PASS",
      summary: "GitHub returned a complete file list.",
      evidence: `The file tree has ${snapshot.paths.length} paths and was not truncated.`,
    };
  }
  const reasons: string[] = [];
  if (snapshot.treeTruncated) reasons.push("GitHub truncated the file tree.");
  if (snapshot.ignoredPathCount > 0) {
    reasons.push(`Ignored ${snapshot.ignoredPathCount} path(s) that were unsafe to interpret.`);
  }
  return {
    ...base,
    severity: "medium",
    status: "NEEDS_REVIEW",
    summary: "The file list is incomplete, so some checks cannot confirm absence.",
    evidence: `${reasons.join(" ")} Missing-file results below are marked needs review instead of fail.`,
  };
}

function archived(snapshot: RepoSnapshot): Finding {
  if (snapshot.archived) {
    return {
      id: "archived",
      title: "Repository activity",
      category: "repository",
      severity: "medium",
      status: "NEEDS_REVIEW",
      summary: "The repository is archived.",
      evidence: "Archived repositories are read-only on GitHub and are a poor release target.",
      paths: [],
    };
  }
  return {
    id: "archived",
    title: "Repository activity",
    category: "repository",
    severity: "info",
    status: "PASS",
    summary: "The repository is not archived.",
    evidence: "GitHub reports this repository as active.",
    paths: [],
  };
}

function readme(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => isRootPath(path) && isReadmePath(path));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "readme",
      title: "README",
      category: "structure",
      severity: "info",
      status: "PASS",
      summary: "A README is present at the repository root.",
      evidence: `Found ${listed.text}.`,
      paths: listed.listed,
    };
  }
  return absent(snapshot, {
    id: "readme",
    title: "README",
    category: "structure",
    severity: "medium",
    summary: "No README was found at the repository root.",
    evidence: "Expected a root file named README or README.md.",
    paths: [],
  });
}

function license(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => isRootPath(path) && isLicensePath(path));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "license",
      title: "License",
      category: "repository",
      severity: "info",
      status: "PASS",
      summary: "A license file is present.",
      evidence: `Found ${listed.text}.`,
      paths: listed.listed,
    };
  }
  if (snapshot.license) {
    return {
      id: "license",
      title: "License",
      category: "repository",
      severity: "info",
      status: "PASS",
      summary: "GitHub reports a detected license.",
      evidence: `GitHub reports the SPDX license ${snapshot.license}.`,
      paths: [],
    };
  }
  return absent(snapshot, {
    id: "license",
    title: "License",
    category: "repository",
    severity: "medium",
    summary: "No license was found.",
    evidence: "No root license file was found, and GitHub did not report an SPDX license.",
    paths: [],
  });
}

function gitignore(snapshot: RepoSnapshot): Finding {
  if (snapshot.paths.includes(".gitignore")) {
    return {
      id: "gitignore",
      title: "Git ignore rules",
      category: "structure",
      severity: "info",
      status: "PASS",
      summary: "A root .gitignore is present.",
      evidence: "Found .gitignore.",
      paths: [".gitignore"],
    };
  }
  return absent(snapshot, {
    id: "gitignore",
    title: "Git ignore rules",
    category: "structure",
    severity: "low",
    summary: "No root .gitignore was found.",
    evidence: "Without .gitignore, build output and local secret files are easier to commit.",
    paths: [],
  });
}

function continuousIntegration(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && isCiPath(path));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "continuous-integration",
      title: "Continuous integration",
      category: "release",
      severity: "info",
      status: "PASS",
      summary: "A CI configuration file is present.",
      evidence: `Found ${listed.text}. This check does not run the workflow.`,
      paths: listed.listed,
    };
  }
  return absent(snapshot, {
    id: "continuous-integration",
    title: "Continuous integration",
    category: "release",
    severity: "medium",
    summary: "No CI configuration was found.",
    evidence: "Looked for GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Bitbucket Pipelines, and a Jenkinsfile.",
    paths: [],
  });
}

function dependencyManifest(snapshot: RepoSnapshot, types: ProjectType[], manifests: string[]): Finding {
  if (types.length > 0) {
    const listed = joinPaths(manifests);
    return {
      id: "dependency-manifest",
      title: "Dependency manifest",
      category: "dependencies",
      severity: "info",
      status: "PASS",
      summary: `Detected ${types.join(", ")}.`,
      evidence: `Manifests: ${listed.text}.`,
      paths: listed.listed,
    };
  }
  const incomplete = listIncomplete(snapshot);
  return {
    id: "dependency-manifest",
    title: "Dependency manifest",
    category: "dependencies",
    severity: "medium",
    status: "NEEDS_REVIEW",
    summary: incomplete
      ? "No supported manifest was found in the partial file list."
      : "No supported dependency manifest was found.",
    evidence: incomplete
      ? "The file list was incomplete, so a package.json, Python manifest, go.mod, Cargo.toml, or Java build file may still exist."
      : "Looked for package.json, pyproject.toml, requirements.txt, Pipfile, setup.py, go.mod, Cargo.toml, pom.xml, and Gradle build files.",
    paths: [],
  };
}

function lockfile(snapshot: RepoSnapshot, types: ProjectType[]): Finding {
  const judged = types.filter((type) => type !== "java");
  if (judged.length === 0) {
    const incomplete = listIncomplete(snapshot);
    if (types.includes("java")) {
      return {
        id: "lockfile",
        title: "Dependency lockfile",
        category: "dependencies",
        severity: "info",
        status: "NOT_CHECKED",
        summary: "Java dependency pinning was not verified.",
        evidence: "Maven and Gradle do not use one root lockfile in the same way as npm. This audit does not resolve Java dependencies.",
        paths: [],
      };
    }
    return {
      id: "lockfile",
      title: "Dependency lockfile",
      category: "dependencies",
      severity: "info",
      status: incomplete ? "NEEDS_REVIEW" : "NOT_CHECKED",
      summary: "Lockfiles were not checked because no supported ecosystem was confirmed.",
      evidence: incomplete
        ? "The file list was incomplete, so a lockfile may still exist."
        : "No Node.js, Python, Go, or Rust manifest was detected.",
      paths: [],
    };
  }

  const parts: Part[] = [];
  if (types.includes("node")) parts.push(nodeLock(snapshot));
  if (types.includes("python")) parts.push(pythonLock(snapshot));
  if (types.includes("go")) parts.push(goLock(snapshot));
  if (types.includes("rust")) parts.push(rustLock(snapshot));
  return combine("lockfile", "Dependency lockfile", "dependencies", parts, "medium", "low");
}

function nodeLock(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && isNodeLock(basename(path)));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Node.js lockfile: ${listed.text}.`, paths: listed.listed };
  }
  if (listIncomplete(snapshot)) {
    return {
      status: "NEEDS_REVIEW",
      evidence: "No Node.js lockfile was in the partial file list, so pinning is not confirmed.",
      paths: [],
    };
  }
  return {
    status: "FAIL",
    evidence: "Node.js: no package-lock.json, pnpm-lock.yaml, yarn.lock, or bun.lock was found.",
    paths: snapshot.paths.includes("package.json") ? ["package.json"] : [],
  };
}

function pythonLock(snapshot: RepoSnapshot): Part {
  const pyproject = snapshot.texts["pyproject.toml"];
  const pyprojectMissing = snapshot.paths.includes("pyproject.toml") && pyproject === undefined;
  const poetry = pyproject ? /\[tool\.poetry\]|poetry-core/.test(pyproject) : false;
  const uv = pyproject ? /\[tool\.uv\]/.test(pyproject) : false;
  const poetryLock = snapshot.paths.some((path) => isProjectPath(path) && basename(path) === "poetry.lock");
  const uvLock = snapshot.paths.some((path) => isProjectPath(path) && basename(path) === "uv.lock");
  const requirements = snapshot.paths.some((path) => isProjectPath(path) && basename(path) === "requirements.txt");

  if (pyprojectMissing && !poetryLock && !uvLock) {
    return {
      status: "NEEDS_REVIEW",
      evidence: "Python: pyproject.toml was not read, so Poetry or uv pinning was not verified.",
      paths: ["pyproject.toml"],
    };
  }
  if (poetry && !poetryLock) {
    return listIncomplete(snapshot)
      ? { status: "NEEDS_REVIEW", evidence: "Python: Poetry is declared and poetry.lock was not in the partial file list.", paths: ["pyproject.toml"] }
      : { status: "FAIL", evidence: "Python: pyproject.toml declares Poetry, but poetry.lock was not found.", paths: ["pyproject.toml"] };
  }
  if (uv && !uvLock) {
    return listIncomplete(snapshot)
      ? { status: "NEEDS_REVIEW", evidence: "Python: uv is declared and uv.lock was not in the partial file list.", paths: ["pyproject.toml"] }
      : { status: "FAIL", evidence: "Python: pyproject.toml declares uv, but uv.lock was not found.", paths: ["pyproject.toml"] };
  }
  if (poetryLock || uvLock) {
    const names = [poetryLock ? "poetry.lock" : "", uvLock ? "uv.lock" : ""].filter((name) => name.length > 0);
    const found = snapshot.paths.filter((path) => isProjectPath(path) && names.includes(basename(path)));
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Python lockfile: ${listed.text}.`, paths: listed.listed };
  }
  if (requirements || snapshot.paths.some((path) => basename(path) === "pyproject.toml" || basename(path) === "setup.py")) {
    return {
      status: "NEEDS_REVIEW",
      evidence: "Python: a manifest is present without a Poetry or uv lockfile. Installs may drift.",
      paths: [],
    };
  }
  return {
    status: "NEEDS_REVIEW",
    evidence: "Python: dependency pinning was not verified.",
    paths: [],
  };
}

function goLock(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && basename(path) === "go.sum");
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Go lockfile: ${listed.text}.`, paths: listed.listed };
  }
  if (listIncomplete(snapshot)) {
    return { status: "NEEDS_REVIEW", evidence: "Go: go.sum was not in the partial file list.", paths: [] };
  }
  return { status: "FAIL", evidence: "Go: go.mod is present and go.sum was not found.", paths: [] };
}

function rustLock(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && basename(path) === "Cargo.lock");
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Rust lockfile: ${listed.text}.`, paths: listed.listed };
  }
  return {
    status: "NEEDS_REVIEW",
    evidence: listIncomplete(snapshot)
      ? "Rust: Cargo.lock was not in the partial file list. Applications should commit it; libraries sometimes omit it."
      : "Rust: Cargo.lock was not found. Applications should commit it; libraries sometimes omit it.",
    paths: [],
  };
}

function javaPinning(types: ProjectType[]): Finding[] {
  if (!types.includes("java") || types.length === 1) return [];
  return [
    {
      id: "java-dependency-pinning",
      title: "Java dependency pinning",
      category: "dependencies",
      severity: "info",
      status: "NOT_CHECKED",
      summary: "Java dependency pinning was not verified.",
      evidence: "Maven and Gradle do not use one root lockfile in the same way as npm. This audit does not resolve Java dependencies.",
      paths: [],
    },
  ];
}

function automatedTests(snapshot: RepoSnapshot, types: ProjectType[]): Finding {
  if (types.length === 0) {
    return {
      id: "automated-tests",
      title: "Automated tests",
      category: "tests",
      severity: "info",
      status: listIncomplete(snapshot) ? "NEEDS_REVIEW" : "NOT_CHECKED",
      summary: "Test configuration was not checked for an unrecognized project.",
      evidence: listIncomplete(snapshot)
        ? "No supported project type was confirmed, and the file list was incomplete. Tests were not executed."
        : "No supported project type was detected. Tests were not executed.",
      paths: [],
    };
  }
  const parts: Part[] = [];
  if (types.includes("node")) parts.push(nodeTests(snapshot));
  if (types.includes("python")) parts.push(pythonTests(snapshot));
  if (types.includes("go")) parts.push(goTests(snapshot));
  if (types.includes("rust")) parts.push(rustTests(snapshot));
  if (types.includes("java")) parts.push(javaTests(snapshot));
  const combined = combine("automated-tests", "Automated tests", "tests", parts, "high", "medium");
  return { ...combined, evidence: `${combined.evidence} Tests were not executed.` };
}

function nodeTests(snapshot: RepoSnapshot): Part {
  const relevant = snapshot.paths.filter(isProjectPath);
  const configs = relevant.filter((path) => isNodeTestConfig(basename(path).toLowerCase()));
  const testFiles = relevant.filter((path) => isNodeTestFile(basename(path)));
  const signals = joinPaths([...configs, ...testFiles]);
  const hasSignals = signals.listed.length > 0;
  const rootListed = snapshot.paths.includes("package.json");

  if (rootListed && snapshot.omittedTexts.includes("package.json")) {
    return {
      status: "NEEDS_REVIEW",
      evidence: "Node.js: the root package.json could not be read, so its test script was not checked.",
      paths: ["package.json", ...signals.listed],
    };
  }

  const text = snapshot.texts["package.json"];
  if (rootListed && text !== undefined) {
    const parsed = readJsonObject(text);
    if (!parsed) {
      return {
        status: "NEEDS_REVIEW",
        evidence: "Node.js: the root package.json is not valid JSON, so its test script was not checked.",
        paths: ["package.json"],
      };
    }
    const scripts = parsed.scripts;
    const script =
      scripts && typeof scripts === "object" && !Array.isArray(scripts)
        ? (scripts as Record<string, unknown>).test
        : undefined;
    if (typeof script === "string" && !isPlaceholderTestScript(script)) {
      return {
        status: "PASS",
        evidence: `Node.js: root test script is "${quoteScript(script)}"${hasSignals ? `. Also found ${signals.text}` : ""}.`,
        paths: ["package.json", ...signals.listed],
      };
    }
    if (hasSignals || listIncomplete(snapshot)) {
      return {
        status: "NEEDS_REVIEW",
        evidence: hasSignals
          ? `Node.js: the root test script is missing or is a placeholder, while test files or config exist (${signals.text}).`
          : "Node.js: the root test script is missing or is a placeholder, and the file list was incomplete.",
        paths: ["package.json", ...signals.listed],
      };
    }
    const detail = typeof script === "string" ? ` The script is "${quoteScript(script)}".` : " scripts.test is missing.";
    return {
      status: "FAIL",
      evidence: `Node.js: no runnable root test script, test config, or test file was found.${detail}`,
      paths: ["package.json"],
    };
  }

  if (hasSignals || listIncomplete(snapshot)) {
    return {
      status: "NEEDS_REVIEW",
      evidence: hasSignals
        ? `Node.js: test files or config exist (${signals.text}), and there is no root package.json test script to confirm they run.`
        : "Node.js: no root package.json was in the partial file list.",
      paths: signals.listed,
    };
  }
  return {
    status: "FAIL",
    evidence: "Node.js: no root test script, test config, or test file was found.",
    paths: [],
  };
}

function isPythonTestPath(path: string): boolean {
  const name = basename(path);
  if (name === "pytest.ini" || name === "tox.ini" || name === "conftest.py") return true;
  if ((name.startsWith("test_") && name.endsWith(".py")) || name.endsWith("_test.py")) return true;
  const segments = path.split("/");
  const inTestDir = segments.slice(0, -1).includes("tests") || segments.slice(0, -1).includes("test");
  return inTestDir && name.endsWith(".py");
}

function pythonTests(snapshot: RepoSnapshot): Part {
  const relevant = snapshot.paths.filter(isProjectPath);
  const files = relevant.filter((path) => isPythonTestPath(path));
  const pyproject = snapshot.texts["pyproject.toml"];
  const declaresPytest = pyproject ? /\[tool\.pytest/.test(pyproject) : false;
  if (files.length > 0 || declaresPytest) {
    const listed = joinPaths(declaresPytest ? ["pyproject.toml", ...files] : files);
    return { status: "PASS", evidence: `Python: found ${listed.text}.`, paths: listed.listed };
  }
  if (listIncomplete(snapshot) || snapshot.omittedTexts.includes("pyproject.toml")) {
    return {
      status: "NEEDS_REVIEW",
      evidence: "Python: no pytest, tox, or tests directory was in the partial file list.",
      paths: [],
    };
  }
  return {
    status: "FAIL",
    evidence: "Python: no pytest config, tox.ini, tests directory, or test_*.py file was found.",
    paths: [],
  };
}

function goTests(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && path.endsWith("_test.go"));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Go: found ${listed.text}.`, paths: listed.listed };
  }
  if (listIncomplete(snapshot)) {
    return { status: "NEEDS_REVIEW", evidence: "Go: no _test.go file was in the partial file list.", paths: [] };
  }
  return { status: "FAIL", evidence: "Go: no _test.go file was found.", paths: [] };
}

function rustTests(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => {
    if (!isProjectPath(path)) return false;
    return path.startsWith("tests/") || path.includes("/tests/") || basename(path) === "tests.rs" || basename(path).endsWith("_test.rs");
  });
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Rust: found ${listed.text}. Inline #[cfg(test)] modules are not parsed.`, paths: listed.listed };
  }
  return {
    status: "NEEDS_REVIEW",
    evidence: "Rust: no tests/ directory or *_test.rs file was found. Inline #[cfg(test)] modules are not parsed.",
    paths: [],
  };
}

function javaTests(snapshot: RepoSnapshot): Part {
  const found = snapshot.paths.filter((path) => isProjectPath(path) && (path.startsWith("src/test/") || path.includes("/src/test/")));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return { status: "PASS", evidence: `Java: found ${listed.text}.`, paths: listed.listed };
  }
  if (listIncomplete(snapshot)) {
    return { status: "NEEDS_REVIEW", evidence: "Java: no src/test directory was in the partial file list.", paths: [] };
  }
  return { status: "FAIL", evidence: "Java: no src/test directory was found.", paths: [] };
}

function nodeModules(snapshot: RepoSnapshot, types: ProjectType[]): Finding {
  const found = snapshot.paths.filter((path) => path.split("/").includes("node_modules"));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "node-modules",
      title: "Committed node_modules",
      category: "dependencies",
      severity: "medium",
      status: "FAIL",
      summary: "node_modules is committed.",
      evidence: `Found ${listed.text}. Install dependencies from a lockfile instead of committing node_modules.`,
      paths: listed.listed,
    };
  }
  if (!types.includes("node")) {
    return {
      id: "node-modules",
      title: "Committed node_modules",
      category: "dependencies",
      severity: "info",
      status: listIncomplete(snapshot) ? "NEEDS_REVIEW" : "NOT_CHECKED",
      summary: "node_modules was not checked as a Node.js release signal.",
      evidence: listIncomplete(snapshot)
        ? "This was not confirmed as a Node.js project, and the file list was incomplete."
        : "This is not a Node.js project, so committed node_modules was not required.",
      paths: [],
    };
  }
  if (listIncomplete(snapshot)) {
    return {
      id: "node-modules",
      title: "Committed node_modules",
      category: "dependencies",
      severity: "low",
      status: "NEEDS_REVIEW",
      summary: "node_modules was not seen, but the file list is incomplete.",
      evidence: "A committed node_modules directory could be missing from the truncated tree.",
      paths: [],
    };
  }
  return {
    id: "node-modules",
    title: "Committed node_modules",
    category: "dependencies",
    severity: "info",
    status: "PASS",
    summary: "node_modules is not committed.",
    evidence: "No path in the file tree includes node_modules.",
    paths: [],
  };
}

function envHygiene(snapshot: RepoSnapshot): Finding {
  const base = {
    id: "env-hygiene",
    title: "Secret filenames",
    category: "security" as const,
  };
  const secretPaths = snapshot.paths.filter((path) => isSecretFilename(basename(path)));
  const pemPaths = snapshot.paths.filter((path) => basename(path).toLowerCase().endsWith(".pem"));
  if (secretPaths.length > 0) {
    const listed = joinPaths(secretPaths);
    return {
      ...base,
      severity: "high",
      status: "FAIL",
      summary: "Files with secret-like names are committed.",
      evidence: `Found ${listed.text}. ShipShape does not read or display their contents.`,
      paths: listed.listed,
    };
  }
  if (pemPaths.length > 0) {
    const listed = joinPaths(pemPaths);
    return {
      ...base,
      severity: "medium",
      status: "NEEDS_REVIEW",
      summary: "PEM files are committed and need a human review.",
      evidence: `Found ${listed.text}. They may be certificates or private keys. Contents were not read.`,
      paths: listed.listed,
    };
  }
  if (listIncomplete(snapshot)) {
    return {
      ...base,
      severity: "medium",
      status: "NEEDS_REVIEW",
      summary: "Secret filenames could not be ruled out.",
      evidence: "No secret-like names appeared in the returned file list, but that list was incomplete. Contents were not read.",
      paths: [],
    };
  }
  if (!snapshot.paths.includes(".gitignore")) {
    return {
      ...base,
      severity: "low",
      status: "NEEDS_REVIEW",
      summary: "No secret-like filenames were found, and there is no root .gitignore.",
      evidence: "A root .gitignore that ignores .env would reduce the chance of committing secrets later.",
      paths: [],
    };
  }
  const gitignoreText = snapshot.texts[".gitignore"];
  if (gitignoreText === undefined) {
    return {
      ...base,
      severity: "low",
      status: "NEEDS_REVIEW",
      summary: "No secret-like filenames were found, but .gitignore could not be read.",
      evidence: "The root .gitignore was present and was not interpreted.",
      paths: [".gitignore"],
    };
  }
  const lines = gitignoreText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.some((line) => line.startsWith("!.env"))) {
    return {
      ...base,
      severity: "medium",
      status: "NEEDS_REVIEW",
      summary: "The gitignore file un-ignores .env paths.",
      evidence: "A negation such as !.env is present in the root .gitignore. Env file contents were not read.",
      paths: [".gitignore"],
    };
  }
  const ignores = lines.some((line) => line === ".env" || line === ".env*" || line === ".env.*" || line === "*.env" || line === ".env.local");
  const example = snapshot.paths.find((path) => [".env.example", ".env.sample", ".env.template"].includes(basename(path)));
  if (ignores) {
    return {
      ...base,
      severity: "info",
      status: "PASS",
      summary: "No secret-like filenames are committed, and .env is gitignored.",
      evidence: example
        ? `The root .gitignore ignores .env. An example env file exists at ${example}.`
        : "The root .gitignore ignores .env. No committed .env or private-key filename was found.",
      paths: example ? [".gitignore", example] : [".gitignore"],
    };
  }
  return {
    ...base,
    severity: "low",
    status: "NEEDS_REVIEW",
    summary: "No secret-like filenames are committed, but .env is not gitignored.",
    evidence: "The root .gitignore has no .env rule.",
    paths: [".gitignore"],
  };
}

function dependencyUpdates(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => {
    return (
      path === ".github/dependabot.yml" ||
      path === ".github/dependabot.yaml" ||
      path === "renovate.json" ||
      path === "renovate.json5" ||
      path === ".renovaterc" ||
      path === ".renovaterc.json" ||
      path === ".github/renovate.json"
    );
  });
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "dependency-updates",
      title: "Dependency update automation",
      category: "security",
      severity: "info",
      status: "PASS",
      summary: "Dependabot or Renovate configuration is present.",
      evidence: `Found ${listed.text}.`,
      paths: listed.listed,
    };
  }
  return absent(snapshot, {
    id: "dependency-updates",
    title: "Dependency update automation",
    category: "security",
    severity: "low",
    summary: "No Dependabot or Renovate configuration was found.",
    evidence: "Looked for .github/dependabot.yml and Renovate config files.",
    paths: [],
  }, "NEEDS_REVIEW");
}

function changelog(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => isRootPath(path) && isChangelogPath(path));
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "changelog",
      title: "Changelog",
      category: "release",
      severity: "info",
      status: "PASS",
      summary: "A changelog is present.",
      evidence: `Found ${listed.text}.`,
      paths: listed.listed,
    };
  }
  return absent(snapshot, {
    id: "changelog",
    title: "Changelog",
    category: "release",
    severity: "low",
    summary: "No changelog was found.",
    evidence: "Looked for a root CHANGELOG, CHANGES, or HISTORY file.",
    paths: [],
  }, "NEEDS_REVIEW");
}

function securityPolicy(snapshot: RepoSnapshot): Finding {
  const found = snapshot.paths.filter((path) => path.toLowerCase() === "security.md" || path.toLowerCase() === ".github/security.md");
  if (found.length > 0) {
    const listed = joinPaths(found);
    return {
      id: "security-policy",
      title: "Security policy",
      category: "security",
      severity: "info",
      status: "PASS",
      summary: "A security policy is present.",
      evidence: `Found ${listed.text}.`,
      paths: listed.listed,
    };
  }
  return absent(snapshot, {
    id: "security-policy",
    title: "Security policy",
    category: "security",
    severity: "low",
    summary: "No SECURITY.md was found.",
    evidence: "Looked for SECURITY.md and .github/SECURITY.md.",
    paths: [],
  }, "NEEDS_REVIEW");
}

function githubRelease(snapshot: RepoSnapshot): Finding {
  if (snapshot.releaseLookup === "failed") {
    return {
      id: "github-release",
      title: "GitHub Release",
      category: "release",
      severity: "info",
      status: "NOT_CHECKED",
      summary: "GitHub Releases could not be read.",
      evidence: "The releases request failed. This is not the same as a repository having no release.",
      paths: [],
    };
  }
  if (snapshot.latestRelease) {
    const kind = snapshot.latestRelease.prerelease ? " It is marked as a prerelease." : "";
    return {
      id: "github-release",
      title: "GitHub Release",
      category: "release",
      severity: "info",
      status: "PASS",
      summary: "A published GitHub Release exists.",
      evidence: `Latest release tag is ${snapshot.latestRelease.tag}.${kind}`,
      paths: [],
    };
  }
  return {
    id: "github-release",
    title: "GitHub Release",
    category: "release",
    severity: "low",
    status: "NEEDS_REVIEW",
    summary: "No published GitHub Release was found.",
    evidence: "Tags can exist without a GitHub Release. This check only reads published releases.",
    paths: [],
  };
}

function branchProtection(): Finding {
  return {
    id: "branch-protection",
    title: "Branch protection",
    category: "security",
    severity: "info",
    status: "NOT_CHECKED",
    summary: "Branch protection was not checked.",
    evidence: "Branch protection and required reviews need repository admin access. This public audit does not check them, so a passing report does not mean the default branch is protected.",
    paths: [],
  };
}

function absent(
  snapshot: RepoSnapshot,
  finding: Omit<Finding, "status">,
  definite: "FAIL" | "NEEDS_REVIEW" = "FAIL",
): Finding {
  if (!listIncomplete(snapshot)) return { ...finding, status: definite };
  return {
    ...finding,
    status: "NEEDS_REVIEW",
    evidence: `${finding.evidence} The file list was incomplete, so this absence is not confirmed.`,
  };
}

function combine(
  id: string,
  title: string,
  category: Finding["category"],
  parts: Part[],
  failSeverity: Severity,
  reviewSeverity: Severity,
): Finding {
  const status = dominant(parts.map((part) => part.status));
  const paths = joinPaths(parts.flatMap((part) => part.paths));
  return {
    id,
    title,
    category,
    severity: severityFor(status, failSeverity, reviewSeverity),
    status,
    summary: summaryFor(title, status),
    evidence: parts.map((part) => part.evidence).join(" "),
    paths: paths.listed,
  };
}

function dominant(statuses: Status[]): Status {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (statuses.includes("PASS")) return "PASS";
  return "NOT_CHECKED";
}

function severityFor(status: Status, failSeverity: Severity, reviewSeverity: Severity): Severity {
  if (status === "FAIL") return failSeverity;
  if (status === "NEEDS_REVIEW") return reviewSeverity;
  return "info";
}

function summaryFor(title: string, status: Status): string {
  if (status === "PASS") return `${title} check passed.`;
  if (status === "FAIL") return `${title} check failed.`;
  if (status === "NEEDS_REVIEW") return `${title} check needs review.`;
  return `${title} was not checked.`;
}
