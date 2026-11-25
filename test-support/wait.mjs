import { setTimeout } from "node:timers/promises";

export async function waitFor(check, timeout = 3000) {
  const until = Date.now() + timeout;
  do {
    const value = await check();
    if (value) return value;
    await setTimeout(5);
  } while (Date.now() < until);
  throw new Error("Timed out waiting for the expected state");
}
