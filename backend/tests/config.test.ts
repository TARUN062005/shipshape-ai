import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const secret = "bc_live_supersecretvalue";

describe("loadConfig", () => {
  it("loads defaults and a BharatCode key without echoing it", () => {
    const config = loadConfig({ BHARATCODE_API_KEY: "bc_live_your_key_here", GITHUB_TOKEN: "ghp_1234567890abcdef" });
    expect(config.port).toBe(8787);
    expect(config.host).toBe("127.0.0.1");
    expect(config.bharatcodeBaseUrl).toBe("https://bharatcode.ai/api/model/v1");
    expect(config.bharatcodeModel).toBe("qwen-3.8-27b");
    expect(config.bharatcodeApiKey).toBe("bc_live_your_key_here");
    expect(config.githubToken).toBe("ghp_1234567890abcdef");
  });

  it("treats a blank key as not configured", () => {
    expect(loadConfig({ BHARATCODE_API_KEY: "   " }).bharatcodeApiKey).toBeNull();
  });

  it("rejects a BharatCode base URL that is not the official host", () => {
    expect(() => loadConfig({ BHARATCODE_BASE_URL: "https://evil.example/api/model/v1", BHARATCODE_API_KEY: secret })).toThrow(ConfigError);
    expect(() => loadConfig({ BHARATCODE_BASE_URL: "http://127.0.0.1/api/model/v1", BHARATCODE_API_KEY: secret })).toThrow(ConfigError);
    expect(() => loadConfig({ BHARATCODE_BASE_URL: "https://bharatcode.ai/collect", BHARATCODE_API_KEY: secret })).toThrow(ConfigError);
    try {
      loadConfig({ BHARATCODE_BASE_URL: "https://user:secret-host@bharatcode.ai/api/model/v1", BHARATCODE_API_KEY: secret });
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect(String(error)).not.toContain(secret);
      expect(String(error)).not.toContain("secret-host");
    }
  });

  it("rejects unsafe bind hosts, ports, tokens, and CORS origins", () => {
    expect(() => loadConfig({ HOST: "169.254.169.254" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "0" })).toThrow(ConfigError);
    expect(() => loadConfig({ PORT: "abc" })).toThrow(ConfigError);
    expect(() => loadConfig({ CORS_ORIGIN: "*" })).toThrow(ConfigError);
    expect(() => loadConfig({ GITHUB_TOKEN: "bad token value" })).toThrow(ConfigError);
    try {
      loadConfig({ GITHUB_TOKEN: "abcdefgh\nexport" });
    } catch (error) {
      expect(String(error)).not.toContain("abcdefgh");
    }
  });
});
