/**
 * PURPOSE
 * Loads the repo-root `.env` for standalone scripts (seed, eval). Next.js does this by itself for
 * the web app. Import this FIRST in any script; settings are validated lazily by src/lib/env.ts.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(import.meta.dirname, "..", ".env");
if (existsSync(envPath)) process.loadEnvFile(envPath);
