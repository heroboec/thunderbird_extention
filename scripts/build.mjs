// Builds dist/<name>-<version>.xpi and dist/updates.json.
//
// Usage: node scripts/build.mjs [--version 1.2.3] [--repo owner/name]
//   --version  defaults to the version in src/manifest.json
//   --repo     defaults to $GITHUB_REPOSITORY; without it no update_url is set
//
// Update scheme: manifest update_url points to
//   https://github.com/<repo>/releases/latest/download/updates.json
// so every release ships its own updates.json pointing at its own .xpi.

import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const root = resolve(import.meta.dirname, "..");
const srcDir = join(root, "src");
const distDir = join(root, "dist");
const stageDir = join(distDir, "stage");

const { values: args } = parseArgs({
  options: {
    version: { type: "string" },
    repo: { type: "string", default: process.env.GITHUB_REPOSITORY },
  },
});

const manifest = JSON.parse(readFileSync(join(srcDir, "manifest.json"), "utf8"));
const version = (args.version ?? manifest.version).replace(/^v/, "");
if (!/^\d+(\.\d+){0,3}$/.test(version)) {
  throw new Error(`Invalid version "${version}", expected e.g. 1.2.3`);
}
manifest.version = version;

const gecko = manifest.browser_specific_settings.gecko;
const slug = manifest.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const xpiName = `${slug}-${version}.xpi`;

if (args.repo) {
  gecko.update_url = `https://github.com/${args.repo}/releases/latest/download/updates.json`;
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir);
cpSync(srcDir, stageDir, { recursive: true });
writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

execFileSync("zip", ["-r", "-X", "-q", join(distDir, xpiName), "."], { cwd: stageDir });
rmSync(stageDir, { recursive: true });

if (args.repo) {
  const updates = {
    addons: {
      [gecko.id]: {
        updates: [
          {
            version,
            update_link: `https://github.com/${args.repo}/releases/download/v${version}/${xpiName}`,
            applications: { gecko: { strict_min_version: gecko.strict_min_version } },
          },
        ],
      },
    },
  };
  writeFileSync(join(distDir, "updates.json"), JSON.stringify(updates, null, 2) + "\n");
}

console.log(`Built dist/${xpiName}` + (args.repo ? " and dist/updates.json" : " (no --repo: update_url not set)"));
