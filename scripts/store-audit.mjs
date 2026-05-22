import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const failures = [];
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));

checkManifestPolicy();
await checkDocs();
await checkNoRemoteCode();

if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  process.exit(1);
}

console.log("Store audit passed: permissions, CSP, docs, and remote-code checks are clean.");

function checkManifestPolicy() {
  const permissions = new Set(manifest.permissions || []);
  for (const permission of ["downloads", "storage", "scripting", "activeTab"]) {
    if (!permissions.has(permission)) failures.push(`missing permission: ${permission}`);
  }
  if (permissions.has("tabs")) failures.push("avoid broad tabs permission; activeTab is sufficient");
  if ((manifest.host_permissions || []).some((host) => host === "https://*.openai.com/*")) {
    failures.push("host permissions include overly broad *.openai.com");
  }
  if (!manifest.content_security_policy?.extension_pages?.includes("script-src 'self'")) {
    failures.push("extension_pages CSP must restrict scripts to self");
  }
}

async function checkDocs() {
  for (const file of ["PRIVACY.md", "SECURITY.md", "RELEASE_CHECKLIST.md", "STORE_LISTING.md"]) {
    try {
      await stat(join(root, file));
    } catch {
      failures.push(`missing store/readiness document: ${file}`);
    }
  }
  const privacy = await readFile(join(root, "PRIVACY.md"), "utf8");
  if (!/does not collect/i.test(privacy)) failures.push("privacy policy must state no collection");
  if (!/not transmit|No .* transmitted/i.test(privacy)) {
    failures.push("privacy policy must state data is not transmitted externally");
  }
}

async function checkNoRemoteCode() {
  const files = await listFiles(root);
  const codeFiles = files.filter((file) => /\.(html|js|mjs)$/u.test(file));
  for (const file of codeFiles) {
    const text = await readFile(file, "utf8");
    if (/<script[^>]+src=["']https?:/iu.test(text)) {
      failures.push(`remote script tag found in ${file}`);
    }
    if (/import\s*\(\s*["']https?:/iu.test(text) || /import\s+.*from\s+["']https?:/iu.test(text)) {
      failures.push(`remote import found in ${file}`);
    }
    if (/\beval\s*\(/u.test(text)) failures.push(`eval usage found in ${file}`);
  }
}

async function listFiles(dir) {
  const output = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", "artifacts"].includes(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) output.push(...await listFiles(path));
    else output.push(path);
  }
  return output;
}
