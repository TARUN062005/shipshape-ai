import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import dotenv from "dotenv";
import { createBharatCodeExplainer } from "./ai/bharatcode.js";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createGithubClient } from "./github/client.js";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(moduleDir, "../.env") });
dotenv.config({ path: path.resolve(moduleDir, "../../.env") });

const config = loadConfig(process.env);
const secrets = [config.bharatcodeApiKey, config.githubToken].filter((value): value is string => value !== null);
const github = createGithubClient({ token: config.githubToken });
const explainer = createBharatCodeExplainer({
  apiKey: config.bharatcodeApiKey,
  model: config.bharatcodeModel,
  baseUrl: config.bharatcodeBaseUrl,
  secrets,
});

const staticDir = path.resolve(moduleDir, "../../frontend/dist");
const app = createApp(
  config,
  {
    loadRepository: github.loadRepository,
    explain: explainer.explain,
  },
  fs.existsSync(path.join(staticDir, "index.html")) ? { staticDir } : {},
);

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  app.listen(config.port, config.host, () => {
    console.log(`ShipShape API listening on http://${config.host}:${config.port}`);
    console.log(`BharatCode explanations: ${config.bharatcodeApiKey ? "configured" : "not configured"}`);
  });
}
