import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./config.js";
import { mapError } from "./http/errors.js";
import type { Logger } from "./logger.js";
import { consoleLogger } from "./logger.js";
import { redactSecrets } from "./safety/secrets.js";
import { analyzeSnapshot } from "./analyzer/analyze.js";
import { buildAuditReport } from "./audit/report.js";
import type { AiExplanation, ExplainInput, RepoSnapshot } from "./types.js";
import { parseRepositoryUrl } from "./validation/repositoryUrl.js";

const auditRequestSchema = z.object({
  repositoryUrl: z.string().trim().min(1).max(300),
});

export interface AuditDependencies {
  loadRepository: (owner: string, repo: string) => Promise<RepoSnapshot>;
  explain: (input: ExplainInput) => Promise<AiExplanation>;
}

export interface CreateAppOptions {
  staticDir?: string;
  logger?: Logger;
}

export function createApp(config: AppConfig, deps: AuditDependencies, options: CreateAppOptions = {}): express.Express {
  const app = express();
  const logger = options.logger ?? consoleLogger;
  const secrets = [config.bharatcodeApiKey, config.githubToken].filter((value): value is string => value !== null);
  const safeLogger: Logger = {
    error(message: string) {
      logger.error(redactSecrets(message, secrets));
    },
  };
  const allow = createRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);

  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });
  app.use(cors({ origin: config.corsOrigin, methods: ["GET", "POST"] }));
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.post("/api/audit", (req, res, next) => {
    if (!allow(req.ip || "unknown")) {
      res.status(429).json({
        error: "Too many audit requests. Wait a minute and try again.",
        code: "RATE_LIMITED",
      });
      return;
    }
    audit(req, res, config, deps, safeLogger).catch(next);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Not found.", code: "NOT_FOUND" });
  });

  if (options.staticDir && fs.existsSync(path.join(options.staticDir, "index.html"))) {
    app.use((req, res, next) => {
      if (!req.path.startsWith("/api")) {
        res.setHeader(
          "Content-Security-Policy",
          "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'",
        );
      }
      next();
    });
    app.use(express.static(options.staticDir, { dotfiles: "deny", index: "index.html" }));
    app.use((req, res, next) => {
      if (req.method !== "GET" || req.path.startsWith("/api")) {
        next();
        return;
      }
      if (!req.headers.accept?.includes("text/html")) {
        next();
        return;
      }
      res.sendFile(path.join(options.staticDir as string, "index.html"));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(err);
      return;
    }
    const mapped = mapError(err);
    if (mapped.status >= 500) logger.error(redactSecrets(mapped.log, secrets));
    res.status(mapped.status).json({ error: mapped.message, code: mapped.code });
  });

  return app;
}

async function audit(
  req: Request,
  res: Response,
  _config: AppConfig,
  deps: AuditDependencies,
  logger: Logger,
): Promise<void> {
  const body = auditRequestSchema.parse(req.body);
  const repository = parseRepositoryUrl(body.repositoryUrl);
  const snapshot = await deps.loadRepository(repository.owner, repository.repo);
  const analysis = analyzeSnapshot(snapshot);

  let ai: AiExplanation;
  try {
    ai = await deps.explain({
      repository: `${repository.owner}/${repository.repo}`,
      projectTypes: analysis.projectTypes,
      findings: analysis.findings.map((finding) => ({
        id: finding.id,
        title: finding.title,
        category: finding.category,
        severity: finding.severity,
        status: finding.status,
        summary: finding.summary,
        evidence: finding.evidence,
        paths: finding.paths,
      })),
    });
  } catch (error) {
    logger.error(error instanceof Error ? error.message.slice(0, 200) : "explanation failed");
    ai = {
      available: false,
      model: null,
      summary: null,
      remediations: [],
      reason: "BharatCode could not be reached. Static findings are unchanged.",
    };
  }

  res.setHeader("Cache-Control", "no-store");
  res.json(buildAuditReport({
    snapshot,
    analysis,
    ai,
    checkedAt: new Date().toISOString(),
  }));
}

function createRateLimiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return function allow(key: string): boolean {
    const now = Date.now();
    if (hits.size > 5000) {
      for (const [entry, stamps] of hits) {
        if (stamps.every((stamp) => now - stamp >= windowMs)) hits.delete(entry);
      }
      if (hits.size > 5000) hits.clear();
    }
    const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  };
}
