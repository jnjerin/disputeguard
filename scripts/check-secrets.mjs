#!/usr/bin/env node
/**
 * PURPOSE
 * A simple secret check that runs as a git hook, because this repo is PUBLIC.
 *
 * Modes:
 *   node scripts/check-secrets.mjs staged        (pre-commit)  checks the files being committed
 *   node scripts/check-secrets.mjs msg <file>    (commit-msg)  checks the commit message
 *   node scripts/check-secrets.mjs history       (manual)      scans every commit ever made,
 *                                                              run before making the repo public
 *
 * It blocks:
 *   1. Any `.env` file except `.env.example`.
 *   2. Any staged content containing a real value from the local `.env` (keys, secrets, ids, the
 *      database URL). Values are compared, never printed: the message names the KEY only.
 *   3. The LIVE PayPal API host (this project is sandbox-only).
 *   4. AI-attribution trailers in commit messages (Co-Authored-By lines, "Generated with ...").
 *
 * Exit code 1 = blocked (git aborts the commit). No dependencies, plain Node.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });

// Built from parts so this file does not match its own rule.
const LIVE_HOSTS = [["api-m", "paypal", "com"].join("."), ["api", "paypal", "com"].join(".")];
const LIVE_RE = new RegExp(`(^|[^.\\w-])(${LIVE_HOSTS.map((h) => h.replace(/\./g, "\\.")).join("|")})`, "i");

/** Non-secret settings that may legitimately appear in the repo. */
const PUBLIC_KEYS = new Set(["META_BASE_URL", "META_MODEL", "PAYPAL_BASE_URL", "NODE_ENV", "APP_URL"]);

/** Reads `.env` and returns [{key, value}] for every value that looks like a secret. */
function secretValues() {
  if (!existsSync(".env")) return [];
  const out = [];
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let value = m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
    if (PUBLIC_KEYS.has(key) || value.length < 8) continue;
    out.push({ key, value });
    // Also catch the password part of a database URL on its own.
    const pw = value.match(/^[a-z]+:\/\/[^:]+:([^@]+)@/i)?.[1];
    if (pw && pw.length >= 8) out.push({ key: `${key} (password)`, value: pw });
  }
  return out;
}

const isEnvFile = (path) => /(^|\/)\.env(\.[^/]*)?$/.test(path) && !path.endsWith(".env.example");

/** Checks one blob of text; returns a list of problems (without revealing values). */
function scanText(where, text, secrets) {
  const problems = [];
  for (const { key, value } of secrets) if (text.includes(value)) problems.push(`${where}: contains the real value of ${key} from .env`);
  if (LIVE_RE.test(text)) problems.push(`${where}: references the LIVE PayPal host (sandbox only)`);
  return problems;
}

function fail(problems) {
  console.error("\n[check-secrets] BLOCKED:");
  for (const p of problems) console.error(`  - ${p}`);
  console.error("\nFix the above, then commit again. (Never bypass with --no-verify.)\n");
  process.exit(1);
}

const mode = process.argv[2];

if (mode === "staged") {
  const secrets = secretValues();
  const files = git("diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z").split("\0").filter(Boolean);
  const problems = [];
  for (const f of files) {
    if (isEnvFile(f)) {
      problems.push(`${f}: .env files must never be committed`);
      continue;
    }
    if (f === "scripts/check-secrets.mjs") continue;
    let content;
    try {
      content = git("show", `:${f}`);
    } catch {
      continue;
    }
    if (content.includes("\0")) continue; // binary file (images, PDFs)
    problems.push(...scanText(f, content, secrets));
  }
  if (problems.length) fail(problems);
  console.log(`[check-secrets] OK (${files.length} staged file(s) checked)`);
} else if (mode === "msg") {
  const msg = readFileSync(process.argv[3], "utf8");
  const problems = [];
  if (/co-authored-by/i.test(msg)) problems.push("commit message contains a Co-Authored-By trailer");
  if (/generated (with|by) .*(claude|ai|gpt|copilot)/i.test(msg) || /claude\.(com|ai)\/|noreply@anthropic/i.test(msg))
    problems.push("commit message contains AI attribution");
  if (problems.length) fail(problems);
} else if (mode === "history") {
  const secrets = secretValues();
  const problems = [];
  const names = git("log", "--all", "--name-only", "--pretty=format:");
  for (const f of new Set(names.split(/\r?\n/).filter(Boolean))) if (isEnvFile(f)) problems.push(`history: ${f} was committed at some point`);
  const patch = git("log", "--all", "-p", "--no-color", "--", ".", ":(exclude)scripts/check-secrets.mjs");
  problems.push(...scanText("history", patch, secrets));
  const msgs = git("log", "--all", "--pretty=format:%H %B");
  if (/co-authored-by/i.test(msgs)) problems.push("history: a commit message contains Co-Authored-By");
  if (problems.length) fail(problems);
  console.log("[check-secrets] history OK: no .env files, no .env values, no live host, no attribution trailers");
} else {
  console.error("usage: check-secrets.mjs staged | msg <file> | history");
  process.exit(2);
}
