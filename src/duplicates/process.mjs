import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { SafetyError } from "../errors.mjs";

export function createDuplicateWorker(filename, mounts) {
  const worker = fileURLToPath(new URL("./worker.mjs", import.meta.url));
  return async ({ scope, emit, signal }) => {
    signal?.throwIfAborted();
    const child = spawn("nice", ["-n", "10", process.execPath, worker], { stdio: ["pipe", "pipe", "ignore"], signal });
    const stopped = new Promise((resolve) => {
      child.once("error", () => {});
      child.once("close", resolve);
    });
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ filename, mounts, scope }));
    const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
    let result;
    try {
      for await (const line of lines) {
        signal?.throwIfAborted();
        const message = JSON.parse(line);
        if (message.progress) await emit?.(message.progress);
        if (message.result) result = message.result;
      }
      const code = await stopped;
      signal?.throwIfAborted();
      if (code !== 0 || !result) throw new SafetyError("scan_failed", "The duplicate scan could not finish");
      return result;
    } finally {
      lines.close();
      if (child.exitCode === null && child.signalCode === null) child.kill();
      await stopped;
    }
  };
}
