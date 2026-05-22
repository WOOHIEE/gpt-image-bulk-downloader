import { readFile, readdir, stat } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { embedPngMetadata, extractTextChunks, listPngChunks } from "../src/lib/png-metadata.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const CRC_TABLE = createCrcTable();

await checkManifest();
await checkJavascriptSyntax();
await checkMetadataRoundTrip();
await checkRequiredAssets();
await checkGalleryScanLimits();
await checkCancellationSupport();
await checkStoreAudit();

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log("Verification passed: manifest, JS syntax, icons, store audit, and PNG metadata round-trip are valid.");

async function checkManifest() {
  const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
  const requiredPermissions = ["downloads", "storage", "scripting"];
  for (const permission of requiredPermissions) {
    if (!manifest.permissions.includes(permission)) {
      failures.push(`manifest is missing ${permission} permission`);
    }
  }
  if (manifest.manifest_version !== 3) failures.push("manifest_version must be 3");
  if (!manifest.background?.service_worker) failures.push("background service worker missing");
}

async function checkJavascriptSyntax() {
  const files = await listFiles(root);
  for (const file of files.filter((entry) => /\.(mjs|js)$/u.test(entry))) {
    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
      cwd: root
    });
    if (result.status !== 0) {
      failures.push(`syntax error in ${relative(root, file)}: ${result.stderr.trim()}`);
    }
  }
}

async function checkMetadataRoundTrip() {
  const png = createTinyPng();
  const prompt = "검은 고양이가 달빛 아래에서 피아노를 치는 장면";
  const output = embedPngMetadata(png, {
    prompt,
    sourceUrl: "https://chatgpt.com/",
    pageUrl: "https://chatgpt.com/c/test",
    conversationTitle: "metadata test",
    createdAt: "2026-05-18T00:00:00.000Z"
  });
  const chunks = listPngChunks(output);
  const texts = extractTextChunks(output);
  if (!chunks.some((chunk) => chunk.type === "iTXt")) failures.push("metadata PNG has no iTXt chunk");
  if (!texts.some((chunk) => chunk.keyword === "Prompt" && chunk.text.includes(prompt))) {
    failures.push("prompt text did not round-trip through iTXt metadata");
  }
}

async function checkRequiredAssets() {
  for (const size of [16, 32, 48, 128]) {
    try {
      await stat(join(root, "assets", `icon-${size}.png`));
    } catch {
      failures.push(`missing assets/icon-${size}.png; run npm run icons`);
    }
  }
}

async function checkGalleryScanLimits() {
  const popup = await readFile(join(root, "src", "popup.js"), "utf8");
  const gallery = await readFile(join(root, "src", "content-gallery.js"), "utf8");
  if (!popup.includes("const galleryScan = imagesPage")) {
    failures.push("popup does not branch ChatGPT Images scans away from normal page scans");
  }
  if (popup.includes("if (settings.embedMetadata) selectedItems = await resolveSelectedPrompts(selectedItems)")) {
    failures.push("popup blocks downloads by resolving all selected prompts before starting a job");
  }
  if (!popup.includes("? { maxItems: 5000, maxPages: 80, limit: 100, loadedOnly: !deep }")) {
    failures.push("popup does not split loaded-only and full ChatGPT Images scans");
  }
  if (gallery.includes("full ? 5000 : 150")) {
    failures.push("content gallery scanner still defaults non-deep scans to 150 items");
  }
  if (!gallery.includes("options.loadedOnly === true") || !gallery.includes("visibleGalleryItems()")) {
    failures.push("content gallery scanner does not support loaded-only image scans");
  }
}

async function checkCancellationSupport() {
  const background = await readFile(join(root, "src", "background.js"), "utf8");
  const engine = await readFile(join(root, "src", "lib", "download-engine.js"), "utf8");
  const popup = await readFile(join(root, "src", "popup.js"), "utf8");
  if (!background.includes("new AbortController()")) {
    failures.push("background jobs do not create an AbortController for cancellation");
  }
  if (!background.includes("chrome.downloads.cancel(activeJob.currentDownloadId)")) {
    failures.push("background cancellation does not cancel the current Chrome download");
  }
  if (!engine.includes("fetch(item.url") || !engine.includes("signal")) {
    failures.push("image fetches are not wired to an abort signal");
  }
  if (!engine.includes("waitForDownload(downloadId, timeoutMs = 180000, signal)")) {
    failures.push("download completion waits are not abortable");
  }
  if (!popup.includes("els.cancelJob.disabled =")) {
    failures.push("popup does not disable the stop button outside running jobs");
  }
}

async function checkStoreAudit() {
  const result = spawnSync(process.execPath, ["scripts/store-audit.mjs"], {
    encoding: "utf8",
    cwd: root
  });
  if (result.status !== 0) {
    failures.push(`store audit failed: ${(result.stderr || result.stdout).trim()}`);
  }
}

async function listFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(path);
  }
  return output;
}

function createTinyPng() {
  const width = 1;
  const height = 1;
  const raw = Buffer.from([0, 255, 255, 255, 255]);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr(width, height)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return new Uint32Array(256).map((_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
}
