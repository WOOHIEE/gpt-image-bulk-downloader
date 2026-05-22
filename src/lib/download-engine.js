import {
  blobToDataUrl,
  buildDownloadFilename,
  buildSidecarFilename,
  extensionForMime,
  formatDateParts,
  makeManifestCsv,
  textToDataUrl
} from "./file-utils.js";
import { embedPngMetadata, isPng } from "./png-metadata.js";

export async function processImageItem(item, oneBasedIndex, settings, tabId, options = {}) {
  const { signal, onDownloadId } = options;
  throwIfAborted(signal);
  const loaded = await loadImageBlob(item, tabId, signal);
  const metadata = buildMetadata(item, oneBasedIndex, loaded.finalUrl);
  let outputBlob = loaded.blob;
  let extension = extensionForMime(outputBlob.type, "png");
  let metadataEmbedded = false;

  if (settings.embedMetadata) {
    try {
      outputBlob = await withPngMetadata(outputBlob, metadata, signal);
      extension = "png";
      metadataEmbedded = true;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!settings.allowOriginalFallback) throw error;
      metadataEmbedded = false;
    }
  }

  const filename = buildDownloadFilenameForItem(settings, item, oneBasedIndex, extension);
  const downloadInfo = await downloadBlob(
    outputBlob,
    filename,
    settings.downloadTimeoutMs,
    signal,
    onDownloadId
  );
  throwIfAborted(signal);

  if (settings.jsonSidecar || (settings.embedMetadata && !metadataEmbedded)) {
    const sidecar = JSON.stringify({ ...metadata, filename, metadataEmbedded }, null, 2);
    await downloadText({
      text: sidecar,
      filename: buildSidecarFilename(filename, "json"),
      mime: "application/json;charset=utf-8",
      timeoutMs: settings.downloadTimeoutMs,
      signal,
      onDownloadId
    });
  }

  return {
    filename,
    actualPath: downloadInfo.filename || "",
    downloadId: downloadInfo.id || "",
    metadataEmbedded,
    sourceMime: loaded.blob.type
  };
}

export async function downloadManifest(payload = {}) {
  const settings = payload.settings;
  const csv = makeManifestCsv(payload.items || []);
  const filename = payload.filename || buildManifestName(settings);
  return downloadText({
    text: csv,
    filename,
    mime: "text/csv;charset=utf-8",
    timeoutMs: settings.downloadTimeoutMs,
    signal: payload.signal,
    onDownloadId: payload.onDownloadId
  });
}

export async function downloadText(payload = {}) {
  throwIfAborted(payload.signal);
  const url = await textToDataUrl(payload.text || "", payload.mime || "text/plain;charset=utf-8");
  throwIfAborted(payload.signal);
  const downloadId = await chrome.downloads.download({
    url,
    filename: payload.filename,
    conflictAction: "uniquify",
    saveAs: false
  });
  payload.onDownloadId?.(downloadId);
  try {
    const info = await waitForDownload(downloadId, payload.timeoutMs || 180000, payload.signal);
    return { filename: payload.filename, actualPath: info.filename, downloadId };
  } finally {
    payload.onDownloadId?.(null);
  }
}

export function buildManifestName(settings) {
  const parts = formatDateParts();
  const folder = settings.folderName
    .replaceAll("{date}", parts.date)
    .replaceAll("{time}", parts.time);
  return `${folder}/manifest-${parts.time}.csv`.replace(/\/+/g, "/");
}

async function withPngMetadata(blob, metadata, signal) {
  throwIfAborted(signal);
  const pngBlob = await ensurePngBlob(blob, signal);
  throwIfAborted(signal);
  const input = await pngBlob.arrayBuffer();
  throwIfAborted(signal);
  const output = embedPngMetadata(input, metadata);
  return new Blob([output], { type: "image/png" });
}

async function ensurePngBlob(blob, signal) {
  throwIfAborted(signal);
  const input = await blob.arrayBuffer();
  if (isPng(input)) return new Blob([input], { type: "image/png" });
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") {
    throw new Error("This Chrome version cannot convert the image to PNG in the worker.");
  }
  throwIfAborted(signal);
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d", { alpha: true });
  context.drawImage(bitmap, 0, 0);
  bitmap.close?.();
  throwIfAborted(signal);
  return canvas.convertToBlob({ type: "image/png" });
}

async function loadImageBlob(item, tabId, signal) {
  if (!item?.url) throw new Error("Image URL is missing.");
  throwIfAborted(signal);
  if (item.url.startsWith("blob:")) {
    const dataUrl = await fetchBlobFromContentScript(item.url, tabId, signal);
    throwIfAborted(signal);
    const response = await fetch(dataUrl, { signal });
    return { blob: await response.blob(), finalUrl: item.url };
  }

  const response = await fetch(item.url, {
    credentials: "include",
    cache: "no-store",
    referrer: item.pageUrl || undefined,
    signal
  });
  if (!response.ok) throw new Error(`Image fetch failed: HTTP ${response.status}`);
  throwIfAborted(signal);
  return { blob: await response.blob(), finalUrl: response.url || item.url };
}

async function fetchBlobFromContentScript(url, tabId, signal) {
  if (!tabId) throw new Error("Blob image requires the original ChatGPT tab.");
  const response = await abortable(chrome.tabs.sendMessage(tabId, {
    type: "GPTIMG_FETCH_AS_DATA_URL",
    payload: { url }
  }), signal);
  if (!response?.ok) throw new Error(response?.error || "Blob fetch failed.");
  return response.payload.dataUrl;
}

async function downloadBlob(blob, filename, timeoutMs, signal, onDownloadId) {
  throwIfAborted(signal);
  const objectUrl = canUseObjectUrl() ? URL.createObjectURL(blob) : null;
  const url = objectUrl || await blobToDataUrl(blob);
  try {
    throwIfAborted(signal);
    const downloadId = await chrome.downloads.download({
      url,
      filename,
      conflictAction: "uniquify",
      saveAs: false
    });
    onDownloadId?.(downloadId);
    return await waitForDownload(downloadId, timeoutMs, signal);
  } finally {
    onDownloadId?.(null);
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 30000);
  }
}

function waitForDownload(downloadId, timeoutMs = 180000, signal) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timeout = setTimeout(() => {
      finish(new Error(`Download timed out after ${Math.round(timeoutMs / 1000)}s.`));
    }, timeoutMs);

    const abortListener = () => {
      chrome.downloads.cancel(downloadId).catch(() => {});
      queryAndFinish(createAbortError());
    };
    const listener = (delta) => {
      if (delta.id !== downloadId || !delta.state?.current) return;
      if (delta.state.current === "complete") queryAndFinish();
      if (delta.state.current === "interrupted") {
        queryAndFinish(signal?.aborted ? createAbortError() : new Error("Chrome interrupted the download."));
      }
    };

    if (signal?.aborted) {
      abortListener();
      return;
    }
    signal?.addEventListener("abort", abortListener, { once: true });
    chrome.downloads.onChanged.addListener(listener);
    chrome.downloads.search({ id: downloadId }).then(([item]) => {
      if (item?.state === "complete") queryAndFinish();
      if (item?.state === "interrupted") queryAndFinish(new Error(item.error || "Download interrupted."));
    }).catch((error) => finish(error));

    function queryAndFinish(error = null) {
      chrome.downloads.search({ id: downloadId })
        .then(([item]) => finish(error || null, item || { id: downloadId }))
        .catch((queryError) => finish(error || queryError));
    }

    function finish(error = null, item = null) {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      chrome.downloads.onChanged.removeListener(listener);
      signal?.removeEventListener("abort", abortListener);
      if (error) {
        const message = `${error.message}${item?.error ? ` (${item.error})` : ""}`;
        reject(error.name === "AbortError" ? createAbortError(message) : new Error(message));
      }
      else resolve(item || { id: downloadId });
    }
  });
}

function buildMetadata(item, oneBasedIndex, sourceUrl) {
  return {
    prompt: item.prompt || "",
    sourceUrl,
    pageUrl: item.pageUrl || "",
    conversationTitle: item.conversationTitle || "",
    imageIndex: oneBasedIndex,
    imageId: item.id || "",
    alt: item.alt || "",
    width: item.width || null,
    height: item.height || null,
    createdAt: new Date().toISOString(),
    tool: "GPT Image Bulk Downloader"
  };
}

function buildDownloadFilenameForItem(settings, item, oneBasedIndex, extension) {
  return buildDownloadFilename(settings, item, oneBasedIndex, extension);
}

function canUseObjectUrl() {
  return typeof URL !== "undefined" && typeof URL.createObjectURL === "function";
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError());
      return;
    }
    const onAbort = () => reject(createAbortError());
    signal?.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => signal?.removeEventListener("abort", onAbort));
  });
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError(message = "Download job was stopped.") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function isAbortError(error) {
  return error?.name === "AbortError";
}
