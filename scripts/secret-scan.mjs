import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const IGNORED_DIRECTORIES = new Set([
  ".git", ".next", ".vercel", ".artifacts", "node_modules", "coverage",
  "out", "dist", "build", "playwright-report", "test-results",
]);
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const RULES = [
  { name: "private-key", pattern: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY(?: BLOCK)?-----/g },
  { name: "github-token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g },
  { name: "aws-access-key", pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: "openai-key", pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
  { name: "stripe-key", pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g },
  { name: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g },
  { name: "google-api-key", pattern: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { name: "npm-token", pattern: /\bnpm_[A-Za-z0-9]{30,}\b/g },
  { name: "vercel-token", pattern: /\bvercel_[A-Za-z0-9_-]{20,}\b/g },
  { name: "jwt", pattern: /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{10,}\b/g },
  { name: "credentials-in-url", pattern: /\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^:\s/@]+:[^@\s/]+@/g },
];
const ASSIGNMENT = /(?:^|[\s,{])["']?([A-Za-z_][A-Za-z0-9_-]*)["']?\s*[:=]\s*["'\x60]?([A-Za-z0-9_+./=-]{12,})/gm;
const SENSITIVE_NAME = /(?:secret|token|password|api[_-]?key|private[_-]?key)$/i;
const PLACEHOLDER = /^(?:your[_-]|replace[_-]|example[_-]|sample[_-]|dummy[_-]|test[_-]|change[_-]?me|placeholder|x+$|process\.env\.|import\.meta\.env\.)/i;

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

/** Return locations and rule names only; never return the matched credential. */
export function scanText(text) {
  const findings = [];
  for (const rule of RULES) {
    for (const match of text.matchAll(rule.pattern)) {
      findings.push({ rule: rule.name, line: lineNumber(text, match.index) });
    }
  }
  for (const match of text.matchAll(ASSIGNMENT)) {
    if (SENSITIVE_NAME.test(match[1]) && !PLACEHOLDER.test(match[2])) {
      findings.push({
        rule: "hardcoded-secret",
        line: lineNumber(text, match.index + match[0].indexOf(match[1])),
      });
    }
  }
  return findings;
}

async function projectFiles(directory, root, files = []) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    // Do not follow links into another repository or the user's home directory.
    if (entry.isSymbolicLink()) continue;
    const path = join(directory, entry.name);
    const relativePath = relative(root, path).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      if (IGNORED_DIRECTORIES.has(entry.name) || relativePath === "public/screenshots") continue;
      await projectFiles(path, root, files);
    } else if (entry.isFile() && !entry.name.endsWith(".tsbuildinfo")) {
      files.push({ path, relativePath });
    }
  }
  return files;
}

export async function scanProject(root = PROJECT_ROOT) {
  const files = await projectFiles(root, root);
  const findings = [];
  let scanned = 0;
  let skipped = 0;
  for (const file of files) {
    const info = await stat(file.path);
    if (info.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    const bytes = await readFile(file.path);
    if (bytes.includes(0)) {
      skipped += 1;
      continue;
    }
    scanned += 1;
    const text = bytes.toString("utf8");
    for (const finding of scanText(text)) {
      findings.push({ file: file.relativePath, ...finding });
    }
  }
  return { findings, scanned, skipped };
}

/** Synthetic fixtures are assembled in memory so no token is checked in. */
export function runSelfTests() {
  const samples = [
    ["gh" + "p_" + "A".repeat(36), "github-token"],
    ["AK" + "IA" + "A".repeat(16), "aws-access-key"],
    ["sk" + "-proj-" + "a".repeat(32), "openai-key"],
    ["-----BEGIN " + "PRIVATE KEY-----", "private-key"],
    [["SERVICE", "TOKEN"].join("_") + "=" + "A1b2C3d4".repeat(4), "hardcoded-secret"],
  ];
  for (const [sample, rule] of samples) {
    assert.ok(scanText(sample).some((finding) => finding.rule === rule), `Missing rule: ${rule}`);
  }
  assert.equal(scanText("const duration = 1234567890123;").length, 0);
  assert.equal(scanText("API_KEY=your_key_here").length, 0);
  assert.equal(scanText("API_KEY=process.env.SERVICE_KEY").length, 0);
  const findings = scanText("first line\n" + samples[0][0]);
  assert.equal(findings[0].line, 2);
  assert.equal(scanText("first line\n" + samples[4][0])[0].line, 2);
  assert.deepEqual(Object.keys(findings[0]).sort(), ["line", "rule"]);
}

async function main() {
  runSelfTests();
  if (process.argv.includes("--self-test")) {
    console.log("Secret scanner self-tests passed.");
    return;
  }
  const { findings, scanned, skipped } = await scanProject();
  if (findings.length) {
    console.error(`Secret scan failed: ${findings.length} potential credential(s).`);
    for (const finding of findings) {
      console.error(`${finding.file}:${finding.line} [${finding.rule}] (value redacted)`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Secret scan passed: ${scanned} text files checked, ${skipped} binary/large files skipped.`);
  console.log("Rule self-tests passed. No known credential pattern detected; this is not a complete security audit.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error("Secret scan could not complete. Check file access and retry; no file contents were logged.");
    process.exitCode = 2;
  });
}
