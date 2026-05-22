import { mkdir, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const releaseDir = join(root, "release");
const zipPath = join(releaseDir, "gpt-image-bulk-downloader.zip");

await mkdir(releaseDir, { recursive: true });
await rm(zipPath, { force: true });

const result = spawnSync("powershell", [
  "-NoProfile",
  "-Command",
  `Compress-Archive -Path '${join(root, "dist", "*").replaceAll("'", "''")}' -DestinationPath '${zipPath.replaceAll("'", "''")}' -Force`
], { encoding: "utf8" });

if (result.status !== 0) {
  console.error(result.stderr || result.stdout);
  process.exit(result.status || 1);
}

console.log(`Release package created: ${zipPath}`);
