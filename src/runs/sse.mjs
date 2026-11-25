import { setTimeout } from "node:timers/promises";

export async function streamRunEvents(engine, userId, runId, response, { after = 0, signal, interval = 500 } = {}) {
  while (!signal?.aborted && !response.destroyed) {
    const events = engine.events(userId, runId, after);
    for (const event of events) {
      after = event.id;
      response.write(`id: ${event.id}\nevent: run\ndata: ${JSON.stringify(event)}\n\n`);
    }
    const state = engine.get(userId, runId).state;
    if (["done", "failed", "killed"].includes(state) && events.length < 200) break;
    try {
      await setTimeout(interval, undefined, { signal });
    } catch (error) {
      if (!signal?.aborted) throw error;
    }
  }
  if (!response.destroyed) response.end();
}
