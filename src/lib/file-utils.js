export const DEFAULT_SETTINGS = Object.freeze({
  folderName: "GPT Images/{date}",
  filenameTemplate: "{index}-{prompt}",
  delayMs: 700,
  maxRetries: 2,
  downloadTimeoutMs: 180000,
  embedMetadata: true,
  manifestAfterDownload: true,
  jsonSidecar: false,
  allowOriginalFallback: true
});

export function normalizeSettings(input = {}) {
  const merged = { ...DEFAULT_SETTINGS, ...input };
  merged.folderName = sanitizePath(merged.folderName || DEFAULT_SETTINGS.folderName);
  merged.filenameTemplate = String(
    merged.filenameTemplate || DEFAULT_SETTINGS.filenameTemplate
  ).trim();
  merged.delayMs = clampNumber(merged.delayMs, 0, 10000, DEFAULT_SETTINGS.delayMs);
  merged.maxRetries = clampNumber(merged.maxRetries, 0, 5, DEFAULT_SETTINGS.maxRetries);
  merged.downloadTimeoutMs = clampNumber(
    merged.downloadTimeoutMs,
    30000,
    600000,
    DEFAULT_SETTINGS.downloadTimeoutMs
  );
  merged.embedMetadata = Boolean(merged.embedMetadata);
  merged.manifestAfterDownload = Boolean(merged.manifestAfterDownload);
  merged.jsonSidecar = Boolean(merged.jsonSidecar);
  merged.allowOriginalFallback = Boolean(merged.allowOriginalFallback);
  return merged;
}

export function formatDateParts(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  };
}

export function buildDownloadFilename(settings, item, oneBasedIndex, extension) {
  const parts = formatDateParts();
  const values = {
    ...parts,
    index: String(oneBasedIndex).padStart(4, "0"),
    prompt: promptSlug(item.prompt || item.alt || "gpt-image"),
    conversation: promptSlug(item.conversationTitle || "chatgpt"),
    imageId: sanitizePathSegment(item.id || `image-${oneBasedIndex}`)
  };
  const body = renderTemplate(settings.filenameTemplate, values) || values.index;
  const folder = renderTemplate(settings.folderName, values);
  const safeFolder = sanitizePath(folder);
  const safeBody = sanitizePathSegment(body);
  return `${safeFolder}/${safeBody}.${extension}`.replace(/\/+/g, "/");
}

export function buildSidecarFilename(imageFilename, extension = "json") {
  return imageFilename.replace(/\.[^.\/]+$/u, `.${extension}`);
}

export function promptSlug(value, maxLength = 80) {
  return sanitizePathSegment(String(value).replace(/\s+/gu, " ").trim(), "prompt")
    .slice(0, maxLength)
    .replace(/[-_ ]+$/u, "");
}

export function sanitizePath(path) {
  return String(path || "")
    .split(/[\\/]+/u)
    .map((part) => sanitizePathSegment(part, "download"))
    .filter(Boolean)
    .join("/");
}

export function sanitizePathSegment(value, fallback = "untitled") {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/[. ]+$/u, "");
  const safe = cleaned || fallback;
  return safe.slice(0, 120);
}

export function truncateText(value, maxLength = 180) {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function makeManifestCsv(items) {
  const header = [
    "index",
    "filename",
    "prompt",
    "source_url",
    "page_url",
    "created_at",
    "prompt_source",
    "conversation_id",
    "message_id",
    "download_id",
    "actual_path",
    "metadata_embedded",
    "attempts",
    "status",
    "error"
  ];
  const rows = items.map((item, index) => [
    index + 1,
    item.filename || "",
    item.prompt || "",
    item.url || "",
    item.pageUrl || "",
    item.createdAt || "",
    item.promptSource || "",
    item.conversationId || "",
    item.messageId || "",
    item.downloadId || "",
    item.actualPath || "",
    item.metadataEmbedded ? "true" : "false",
    item.attempts || "",
    item.status || "",
    item.error || ""
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
}

export async function textToDataUrl(text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
  return blobToDataUrl(blob);
}

export async function blobToDataUrl(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`;
}

export function extensionForMime(mime, fallback = "bin") {
  const normalized = String(mime || "").split(";")[0].trim().toLowerCase();
  if (normalized === "image/png") return "png";
  if (normalized === "image/jpeg") return "jpg";
  if (normalized === "image/webp") return "webp";
  if (normalized === "image/gif") return "gif";
  return fallback;
}

function renderTemplate(template, values) {
  return String(template || "").replace(/\{([a-zA-Z0-9_]+)\}/gu, (_, key) => {
    return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : "";
  });
}

function csvCell(value) {
  return `"${String(value ?? "").replace(/"/gu, '""')}"`;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}
