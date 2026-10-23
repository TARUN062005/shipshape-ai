export interface AppConfig {
  port: number;
  host: string;
  corsOrigin: string;
  githubToken: string | null;
  bharatcodeApiKey: string | null;
  bharatcodeModel: string;
  bharatcodeBaseUrl: string;
  rateLimitMax: number;
  rateLimitWindowMs: number;
}

export class ConfigError extends Error {
  readonly code = "CONFIG" as const;

  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

const BIND_HOSTS = new Set(["127.0.0.1", "::1", "localhost", "0.0.0.0"]);
const DEFAULT_MODEL = "qwen-3.8-27b";
const DEFAULT_BASE = "https://bharatcode.ai/api/model/v1";
const SAFE_SECRET = /^[A-Za-z0-9._~+/=-]{8,400}$/;
const SAFE_MODEL = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  return {
    port: parsePort(env.PORT ?? "8787"),
    host: parseHost(env.HOST ?? "127.0.0.1"),
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN ?? "http://localhost:5173"),
    githubToken: optionalSecret(env.GITHUB_TOKEN, "GITHUB_TOKEN"),
    bharatcodeApiKey: optionalSecret(env.BHARATCODE_API_KEY, "BHARATCODE_API_KEY"),
    bharatcodeModel: parseModel(env.BHARATCODE_MODEL ?? DEFAULT_MODEL),
    bharatcodeBaseUrl: parseBharatCodeBase(env.BHARATCODE_BASE_URL ?? DEFAULT_BASE),
    rateLimitMax: parseBoundedInt(env.RATE_LIMIT_MAX ?? "20", 1, 100, "RATE_LIMIT_MAX"),
    rateLimitWindowMs: parseBoundedInt(env.RATE_LIMIT_WINDOW_MS ?? "60000", 1000, 3_600_000, "RATE_LIMIT_WINDOW_MS"),
  };
}

function optionalSecret(value: string | undefined, name: string): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!SAFE_SECRET.test(trimmed)) {
    throw new ConfigError(`${name} contains unsupported characters or has an unexpected length.`);
  }
  return trimmed;
}

function parsePort(value: string): number {
  if (!/^\d+$/.test(value)) throw new ConfigError("PORT must be an integer between 1 and 65535.");
  const port = Number(value);
  if (port < 1 || port > 65535) throw new ConfigError("PORT must be an integer between 1 and 65535.");
  return port;
}

function parseHost(value: string): string {
  const host = value.trim();
  if (!BIND_HOSTS.has(host)) {
    throw new ConfigError("HOST must be 127.0.0.1, ::1, localhost, or 0.0.0.0.");
  }
  return host;
}

function parseCorsOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConfigError("CORS_ORIGIN must be an http(s) origin.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConfigError("CORS_ORIGIN must be an http(s) origin.");
  }
  if (url.username || url.password) throw new ConfigError("CORS_ORIGIN must not include credentials.");
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new ConfigError("CORS_ORIGIN must be an origin without a path.");
  }
  return url.origin;
}

function parseModel(value: string): string {
  const model = value.trim();
  if (!SAFE_MODEL.test(model)) throw new ConfigError("BHARATCODE_MODEL contains unsupported characters.");
  return model;
}

/**
 * The API key is sent only to BharatCode. A configurable base URL must stay on
 * that host so a bad environment cannot turn the server into an open proxy.
 */
export function parseBharatCodeBase(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new ConfigError("BHARATCODE_BASE_URL must be an https://bharatcode.ai URL.");
  }
  if (url.protocol !== "https:" || url.hostname !== "bharatcode.ai" || url.port || url.username || url.password) {
    throw new ConfigError("BHARATCODE_BASE_URL must be an https://bharatcode.ai URL.");
  }
  if (url.search || url.hash) throw new ConfigError("BHARATCODE_BASE_URL must not include a query or hash.");
  const path = url.pathname.replace(/\/$/, "");
  if (path !== "/api/model/v1" && !path.startsWith("/api/model/")) {
    throw new ConfigError("BHARATCODE_BASE_URL must stay under /api/model/.");
  }
  return `https://bharatcode.ai${path}`;
}

function parseBoundedInt(value: string, min: number, max: number, name: string): number {
  if (!/^\d+$/.test(value)) throw new ConfigError(`${name} must be an integer.`);
  const parsed = Number(value);
  if (parsed < min || parsed > max) throw new ConfigError(`${name} must be between ${min} and ${max}.`);
  return parsed;
}
