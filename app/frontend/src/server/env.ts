import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Project root is two levels above app/frontend. */
export const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");

let cached: string | null | undefined;

/** Reads MURF_API_KEY from the environment or the root .env file. Server only. */
export function getMurfKey(): string | null {
  if (process.env.MURF_API_KEY) return process.env.MURF_API_KEY;
  if (cached !== undefined) return cached;
  cached = null;
  try {
    const text = readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*MURF_API_KEY\s*=\s*(.*)\s*$/);
      if (m) cached = m[1].replace(/^["']|["']$/g, "").trim() || null;
    }
  } catch {
    /* no .env */
  }
  return cached;
}
