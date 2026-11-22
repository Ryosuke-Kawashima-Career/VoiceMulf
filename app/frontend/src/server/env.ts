import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

/** Project root is two levels above app/frontend. */
export const PROJECT_ROOT = path.resolve(process.cwd(), "..", "..");

let rootEnv: Record<string, string> | null = null;

function readRootEnv(): Record<string, string> {
  if (rootEnv) return rootEnv;
  rootEnv = {};
  try {
    const text = readFileSync(path.join(PROJECT_ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) rootEnv[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch {
    /* no .env */
  }
  return rootEnv;
}

/** Reads a setting from the environment or the project-root .env file. Server only. */
export function getEnv(name: string): string | null {
  return process.env[name] || readRootEnv()[name] || null;
}

export function getMurfKey(): string | null {
  return getEnv("MURF_API_KEY");
}
