import { appendFile } from "node:fs/promises";
import { existsSync, mkdirSync } from "node:fs";

if (!existsSync("data")) {
  mkdirSync("data");
}

export const EVENTS_FILE = "data/events.jsonl";

export async function logEvent(type: string, payload: any) {
  const event = {
    id: crypto.randomUUID(),
    type,
    payload,
    timestamp: new Date().toISOString()
  };
  const line = JSON.stringify(event) + "\n";
  await appendFile(EVENTS_FILE, line);
  return event;
}
