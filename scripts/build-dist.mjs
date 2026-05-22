import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const dist = join(root, "dist");
const required = [
  "manifest.json",
  "popup.html",
  "options.html",
  "LICENSE",
  "PRIVACY.md",
  "README.md",
  "README.ko.md",
  "SECURITY.md",
  "CHANGELOG.md"
];
const directories = ["src", "assets"];

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of required) {
  await cp(join(root, file), join(dist, file));
}
for (const dir of directories) {
  await cp(join(root, dir), join(dist, dir), { recursive: true });
}

const manifest = JSON.parse(await readFile(join(dist, "manifest.json"), "utf8"));
manifest.version_name = `${manifest.version} local`;
await writeFile(join(dist, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built unpacked extension bundle: ${dist}`);
