export const AUDIT_LIMITATIONS = [
  "Static analysis only. Repository tests, builds, and dependency installs were not run.",
  "Only public GitHub repositories are read, and only through api.github.com.",
  "A missing file is treated as a failure only when GitHub returned a complete file list.",
  "Branch protection, required reviews, and secrets inside ordinary source files are not checked.",
  "BharatCode explains these findings. It does not independently scan the repository.",
] as const;
