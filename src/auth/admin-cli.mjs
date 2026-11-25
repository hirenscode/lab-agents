import { loadConfig } from "../config.mjs";
import { initializeDataDirectory } from "../storage.mjs";
import { openDatabase } from "../db/database.mjs";
import { saveLocalAdmin } from "./sessions.mjs";

const username = process.argv[2];
let password = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) {
  password += chunk;
  if (password.length > 1026) throw new Error("Password exceeds the input limit");
}
const database = openDatabase(initializeDataDirectory(loadConfig().dataDir));
try {
  await saveLocalAdmin(database, username, password.replace(/\r?\n$/, ""));
  console.log("Local administrator saved.");
} finally { database.close(); }
