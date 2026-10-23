import type { ProjectType } from "../types.js";
import { basename, isProjectPath } from "./paths.js";

export interface Detection {
  types: ProjectType[];
  manifests: string[];
}

const PYTHON_MANIFEST = /(^|\/)(pyproject\.toml|requirements\.txt|requirements-dev\.txt|Pipfile|setup\.py|setup\.cfg)$/;

export function detectProject(paths: readonly string[]): Detection {
  const relevant = paths.filter(isProjectPath);
  const types: ProjectType[] = [];
  const manifests: string[] = [];

  const nodeManifests = relevant.filter((path) => path === "package.json" || path.endsWith("/package.json"));
  if (nodeManifests.length > 0) {
    types.push("node");
    manifests.push(...nodeManifests);
  }

  const pythonManifests = relevant.filter((path) => PYTHON_MANIFEST.test(path));
  if (pythonManifests.length > 0) {
    types.push("python");
    manifests.push(...pythonManifests);
  }

  const goManifests = relevant.filter((path) => path === "go.mod" || path.endsWith("/go.mod"));
  if (goManifests.length > 0) {
    types.push("go");
    manifests.push(...goManifests);
  }

  const rustManifests = relevant.filter((path) => path === "Cargo.toml" || path.endsWith("/Cargo.toml"));
  if (rustManifests.length > 0) {
    types.push("rust");
    manifests.push(...rustManifests);
  }

  const javaManifests = relevant.filter((path) => {
    const name = basename(path);
    return name === "pom.xml" || name === "build.gradle" || name === "build.gradle.kts";
  });
  if (javaManifests.length > 0) {
    types.push("java");
    manifests.push(...javaManifests);
  }

  return { types, manifests };
}
