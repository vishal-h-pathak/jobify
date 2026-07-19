import * as fs from "node:fs";

/** Minimal `.env`-style parser — no dependency needed for the one file `runSim.ts` reads. */
export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    const isQuoted =
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2);
    if (isQuoted) value = value.slice(1, -1);
    if (key) result[key] = value;
  }
  return result;
}

/**
 * Loads `web/.env.local` (if present) and fills in any of its variables
 * that aren't already set in `process.env` — same "don't override the
 * real environment" precedence `dotenv` uses. `runSim.ts` is a standalone
 * tsx script, not Next.js, so nothing else loads this file for it.
 */
export function loadDotEnvLocalIntoProcessEnv(path = ".env.local"): void {
  let content: string;
  try {
    content = fs.readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const [key, value] of Object.entries(parseEnvFile(content))) {
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
