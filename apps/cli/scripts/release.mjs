#!/usr/bin/env node

/**
 * Interactive CLI release script for artbin.
 *
 * Usage: node apps/cli/scripts/release.mjs
 *
 * Steps:
 *   1. Show current version
 *   2. Prompt for new version
 *   3. Update package.json
 *   4. Build (UI + tsup)
 *   5. Dry-run publish to show what would be published
 *   6. Confirm and publish
 *   7. Git commit + tag
 */

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_DIR = join(__dirname, "..");
const PKG_PATH = join(CLI_DIR, "package.json");

function run(cmd, opts = {}) {
  console.log(`\n  $ ${cmd}`);
  return execSync(cmd, { stdio: "inherit", cwd: CLI_DIR, ...opts });
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readPkg() {
  return JSON.parse(readFileSync(PKG_PATH, "utf-8"));
}

function writePkg(pkg) {
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
}

function isValidSemver(v) {
  return /^\d+\.\d+\.\d+(-[\w.]+)?$/.test(v);
}

async function main() {
  const pkg = readPkg();
  const current = pkg.version;

  console.log(`\n  artbin CLI release`);
  console.log(`  current version: ${current}\n`);

  // Suggest next versions
  const [major, minor, patch] = current.split("-")[0].split(".").map(Number);
  const suggestions = [
    `${major}.${minor}.${patch + 1}`,
    `${major}.${minor + 1}.0`,
    `${major + 1}.0.0`,
  ];
  console.log(`  suggestions: ${suggestions.join(", ")}`);

  const newVersion = await ask(`\n  new version: `);

  if (!newVersion) {
    console.log("  aborted.");
    process.exit(0);
  }

  if (!isValidSemver(newVersion)) {
    console.error(`  "${newVersion}" is not valid semver`);
    process.exit(1);
  }

  if (newVersion === current) {
    console.error(`  version is already ${current}`);
    process.exit(1);
  }

  // Update package.json
  pkg.version = newVersion;
  writePkg(pkg);
  console.log(`\n  updated package.json: ${current} -> ${newVersion}`);

  // Build
  console.log(`\n  building...`);
  run("pnpm run build");

  // Dry-run publish
  console.log(`\n  dry-run publish:`);
  run("pnpm publish --dry-run --no-git-checks");

  // Confirm
  const confirm = await ask(`\n  publish artbin@${newVersion} to npm? (y/N) `);

  if (confirm.toLowerCase() !== "y") {
    // Revert package.json
    pkg.version = current;
    writePkg(pkg);
    console.log(`  reverted to ${current}. aborted.`);
    process.exit(0);
  }

  // Publish
  console.log(`\n  publishing...`);
  run("pnpm publish --no-git-checks");

  // Git commit + tag
  console.log(`\n  committing and tagging...`);
  run(`git add package.json`, { cwd: CLI_DIR });
  run(`git commit -m "release: artbin@${newVersion}"`, { cwd: join(CLI_DIR, "../..") });
  run(`git tag -a "artbin@${newVersion}" -m "artbin@${newVersion}"`, {
    cwd: join(CLI_DIR, "../.."),
  });

  console.log(`\n  done! artbin@${newVersion} published.`);
  console.log(`  don't forget: git push && git push --tags\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
