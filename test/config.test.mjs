import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { loadConfig } from "../src/config.mjs";
import { ConfigError } from "../src/errors.mjs";

test("loadConfig returns the local defaults", () => {
  const config = loadConfig({});
  assert.equal(config.name, "lab-agents");
  assert.match(config.version, /^\d+\.\d+\.\d+$/);
  assert.equal(config.nodeEnv, "development");
  assert.equal(config.port, 8787);
  assert.equal(config.dataDir, resolve("./data"));
});

test("loadConfig accepts deployment overrides and port 0 for ephemeral listeners", () => {
  const config = loadConfig({
    NODE_ENV: "production",
    PORT: "0",
    DATA_DIR: "custom-data",
    APP_VERSION: "v1.2.3",
  });
  assert.equal(config.nodeEnv, "production");
  assert.equal(config.port, 0);
  assert.equal(config.dataDir, resolve("custom-data"));
  assert.equal(config.version, "v1.2.3");
});

test("loadConfig rejects malformed settings with a typed error", () => {
  const invalid = [
    ["NODE_ENV", "prod"],
    ["PORT", "-1"],
    ["PORT", "1.5"],
    ["PORT", "65536"],
    ["PORT", "0x10"],
    ["PORT", "8787abc"],
    ["DATA_DIR", "   "],
    ["DATA_DIR", "bad\0path"],
    ["APP_VERSION", "build\nnumber"],
  ];
  for (const [name, value] of invalid) {
    assert.throws(() => loadConfig({ [name]: value }), {
      name: ConfigError.name,
      message: new RegExp(`^${name} `),
    });
  }
});
