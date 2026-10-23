# ShipShape AI

ShipShape is a release inspector for public GitHub repositories. It reads a repository through the GitHub API, runs deterministic checks, and asks BharatCode to explain those findings. It does not install the project, run its tests, or push commits.

## What a report means

Each check is one of:

| Status | Meaning |
| --- | --- |
| PASS | The signal was found. |
| FAIL | The signal was confirmed missing or unsafe. Medium, high, and critical failures fail the report. |
| NEEDS REVIEW | A person should look, or the file list was incomplete so an absence is not confirmed. A low failure also holds the report here. |
| NOT CHECKED | The auditor did not perform that check. Branch protection is always in this state. |

The check score is the share of applicable checks that passed. Not-checked items are excluded. A passing report is not a security certification and does not mean the repository's own tests passed.

BharatCode receives the verified findings and returns a summary plus remediation for failed and review items. It is not a second scanner. If `BHARATCODE_API_KEY` is unset or the model response cannot be parsed, the static report is still returned.

## Checks

- README, license, changelog, and root `.gitignore`
- CI config (GitHub Actions, GitLab CI, CircleCI, Azure Pipelines, Bitbucket Pipelines, Jenkinsfile)
- Supported manifests: Node.js, Python, Go, Rust, and Java
- Lockfiles for Node.js, Poetry, uv, Go, and Rust. Java pinning is not checked
- Test configuration and test filenames. The commands are not executed
- Committed `node_modules`
- Secret-like filenames (`.env`, private key names, PEM files). File contents of those names are not read or sent to BharatCode
- Dependabot or Renovate config
- A published GitHub Release
- Whether GitHub truncated the file tree

## Architecture

```
frontend/   React + TypeScript + Vite + Tailwind
backend/    Express + TypeScript + Zod + Vitest
```

The browser calls `POST /api/audit` on this backend. The backend allows only `https://github.com/<owner>/<repo>`, then calls `https://api.github.com` with the owner and repo it parsed. Redirects that leave `api.github.com` are refused. BharatCode is called only from the backend, and only at `https://bharatcode.ai`.

```
Browser -> ShipShape API -> GitHub REST API
                         -> BharatCode chat completions
```

No repository URL is fetched directly, and nothing from the repository is passed to a shell.

## Setup

Requires Node.js 20 or newer.

```bash
npm install
copy .env.example .env   # Windows
# cp .env.example .env   # macOS or Linux
```

Edit `.env` and set `BHARATCODE_API_KEY`. A `GITHUB_TOKEN` with public read access is optional and avoids low unauthenticated rate limits. Do not put either value in `frontend/.env` or in a `VITE_` variable.

```bash
npm test
npm run dev
```

Open http://localhost:5173. The Vite server proxies `/api` to http://127.0.0.1:8787.

Production build:

```bash
npm run build
npm start
```

`npm start` serves the API and, when `frontend/dist` exists, the built dashboard on the same origin.

## API

`GET /api/health` returns `{ "ok": true }`.

`POST /api/audit`

```json
{ "repositoryUrl": "https://github.com/owner/repo" }
```

The response contains `repository`, `projectTypes`, `summary`, `findings`, `ai`, and `limitations`. Findings include `status`, `severity`, `evidence`, `paths`, and BharatCode `guidance` when one was returned for that id. Errors use `{ "error", "code" }`.

## Development

```bash
npm test
npm run typecheck
npm run build
```

Backend tests cover URL allowlisting, the analyzer, the GitHub client, the BharatCode client, and the HTTP API. They use injected fetch mocks, so they do not call GitHub or BharatCode. Frontend tests cover status labels, finding order, and API base handling.

## Limitations

- Public GitHub repositories only. Private repositories are rejected before their tree is read.
- Static signals only. A green test badge in the report means a test file or script exists, not that it passed.
- An incomplete GitHub tree downgrades missing-file failures to needs review.
- Branch protection, code scanning, and dependency CVE lookups are not implemented.
- There is no commit, pull request, or push automation.
