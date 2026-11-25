import { openDatabase } from "../db/database.mjs";
import { createPathGuard } from "../safety/path-guard.mjs";
import { createDuplicateScanner } from "./scan.mjs";

let input = "";
for await (const chunk of process.stdin.setEncoding("utf8")) {
  input += chunk;
  if (input.length > 100000) throw new Error("Invalid scan settings");
}
const { filename, mounts, scope } = JSON.parse(input);
const database = openDatabase(filename);
try {
  const scan = createDuplicateScanner(database);
  const result = await scan({ pathGuard: createPathGuard(mounts), scope,
    emit: (progress) => process.stdout.write(JSON.stringify({ progress }) + "\n") });
  process.stdout.write(JSON.stringify({ result }) + "\n");
} finally { database.close(); }
