#!/usr/bin/env node

/**
 * Publish the already-versioned artbin CLI from a clean Git commit.
 *
 * Run from apps/cli with: pnpm run release
 */

import { readFileSync } from "fs";
import { execFileSync, execSync } from "child_process";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const cliDir = join(scriptDir, "..");
const repoRoot = join(cliDir, "../..");
const packagePath = join(cliDir, "package.json");

function run(command, cwd = cliDir) {
  console.log(`\n  $ ${command}`);
  return execSync(command, { stdio: "inherit", cwd });
}

function output(command, cwd = repoRoot) {
  return execSync(command, { encoding: "utf8", cwd }).trim();
}

function ask(question) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    readline.question(question, (answer) => {
      readline.close();
      resolve(answer.trim());
    });
  });
}

function isPublished(name, version) {
  try {
    execFileSync("npm", ["view", `${name}@${version}`, "version"], {
      cwd: cliDir,
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));
  const { name, version } = packageJson;

  console.log(`\n  artbin CLI release`);
  console.log(`  package: ${name}@${version}`);

  const status = output("git status --porcelain");
  if (status) {
    console.error("\n  The repository has uncommitted changes. Commit and push them first.");
    process.exit(1);
  }

  if (isPublished(name, version)) {
    console.error(`\n  ${name}@${version} is already published.`);
    process.exit(1);
  }

  run("pnpm run ci");
  run("pnpm publish --dry-run --access public");

  const confirmation = await ask(`\n  Publish ${name}@${version} to npm? (y/N) `);
  if (confirmation.toLowerCase() !== "y") {
    console.log("  Aborted. Nothing was published.");
    return;
  }

  run("pnpm publish --access public");

  const tag = `${name}@${version}`;
  run(`git tag -a "${tag}" -m "${tag}"`, repoRoot);
  run(`git push origin "${tag}"`, repoRoot);

  console.log(`\n  Published ${name}@${version} and pushed ${tag}.\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
