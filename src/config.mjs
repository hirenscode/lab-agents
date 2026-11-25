import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConfigError } from "./errors.mjs";

const { name, version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

export function loadConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  if (!["development", "test", "production"].includes(nodeEnv)) {
    throw new ConfigError("NODE_ENV must be development, test, or production");
  }

  const port = env.PORT || "8787";
  if (!/^\d+$/.test(port) || Number(port) > 65535) {
    throw new ConfigError("PORT must be an integer from 0 to 65535");
  }

  const dataDir = env.DATA_DIR || "./data";
  if (dataDir.trim() === "" || dataDir.includes("\0")) {
    throw new ConfigError("DATA_DIR must be a valid directory path");
  }

  const appVersion = env.APP_VERSION || version;
  if (appVersion.trim() === "" || /[\x00-\x1f\x7f]/.test(appVersion)) {
    throw new ConfigError("APP_VERSION must be a single line of text");
  }

  return { name, version: appVersion, nodeEnv, port: Number(port), dataDir: resolve(dataDir) };
}
