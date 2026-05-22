import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/file-utils.js";
import { downloadManifest, downloadText, processImageItem } from "./lib/download-engine.js";

const JOB_HISTORY_LIMIT = 10;
let activeJob = null;
let activeAbortController = null;

chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get("settings");
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((payload) => sendResponse({ ok: true, payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

async function handleMessage(message, sender) {
  switch (message?.type) {
    case "GPTIMG_GET_STATUS":
      return { activeJob: summarizeJob(activeJob) };
    case "GPTIMG_GET_HISTORY":
      return getJobHistory();
    case "GPTIMG_START_DOWNLOADS":
      return startJob(message.payload);
    case "GPTIMG_RETRY_FAILED":
      return retryFailed(message.payload);
    case "GPTIMG_CANCEL_DOWNLOADS":
      return cancelActiveJob();
    case "GPTIMG_EXPORT_MANIFEST":
      return downloadManifest({
        ...message.payload,
        settings: normalizeSettings(message.payload?.settings)
      });
    case "GPTIMG_DOWNLOAD_TEXT":
      return downloadText(message.payload);
    default:
      throw new Error(`Unknown message type: ${message?.type || "missing"}`);
  }
}

async function startJob(payload = {}) {
  if (activeJob?.running) {
    throw new Error("A download job is already running.");
  }
  const items = Array.isArray(payload.items) ? payload.items : [];
  if (!items.length) throw new Error("No image items were provided.");

  const settings = normalizeSettings(payload.settings);
  activeAbortController = new AbortController();
  activeJob = {
    id: crypto.randomUUID(),
    running: true,
    cancelRequested: false,
    total: items.length,
    completed: 0,
    failed: 0,
    skipped: 0,
    current: "",
    settings,
    tabId: payload.tabId || null,
    currentDownloadId: null,
    startedAt: new Date().toISOString(),
    finishedAt: "",
    results: []
  };

  runJob(items, settings, payload.tabId).catch((error) => {
    if (!activeJob) return;
    activeJob.running = false;
    activeJob.cancelRequested = activeJob.cancelRequested || isCancelError(error);
    activeJob.current = activeJob.cancelRequested ? "Stopped" : error.message;
    activeJob.currentDownloadId = null;
    activeJob.finishedAt = new Date().toISOString();
    activeAbortController = null;
    saveJobHistory(activeJob);
    broadcastProgress();
  });
  broadcastProgress();
  return { activeJob: summarizeJob(activeJob) };
}

async function runJob(items, settings, tabId) {
  const signal = activeAbortController?.signal;
  for (let index = 0; index < items.length; index += 1) {
    if (isJobCancelled(signal)) break;
    let item = items[index];
    updateJob({ current: item.prompt || item.url || `image ${index + 1}` });

    try {
      item = await resolvePromptForDownload(item, settings, tabId, signal);
      throwIfJobCancelled(signal);
      const result = await processImageItemWithRetries(item, index + 1, settings, tabId, signal);
      activeJob.completed += 1;
      activeJob.results.push({ ...item, ...result, status: "complete" });
    } catch (error) {
      if (isCancelError(error) || isJobCancelled(signal)) {
        activeJob.cancelRequested = true;
        break;
      }
      activeJob.failed += 1;
      activeJob.results.push({
        ...item,
        status: "failed",
        error: error.message,
        attempts: settings.maxRetries + 1
      });
    }
    updateJob();
    if (settings.delayMs > 0) {
      try {
        await sleep(settings.delayMs, signal);
      } catch (error) {
        if (isCancelError(error)) {
          activeJob.cancelRequested = true;
          break;
        }
        throw error;
      }
    }
  }

  updateJob({
    skipped: Math.max(0, activeJob.total - activeJob.completed - activeJob.failed)
  });

  if (!activeJob.cancelRequested && settings.manifestAfterDownload && activeJob.results.length) {
    try {
      const manifestResult = await downloadManifest({
        items: activeJob.results,
        settings,
        signal,
        onDownloadId(downloadId) {
          updateJob({ currentDownloadId: downloadId || null });
        }
      });
      activeJob.results.push({
        id: "manifest",
        status: "complete",
        prompt: "CSV manifest",
        filename: manifestResult.filename || "",
        actualPath: manifestResult.actualPath || "",
        downloadId: manifestResult.downloadId || "",
        metadataEmbedded: false,
        attempts: 1
      });
    } catch (error) {
      if (isCancelError(error) || isJobCancelled(signal)) {
        activeJob.cancelRequested = true;
      } else {
        activeJob.results.push({
          status: "failed",
          error: `Manifest export failed: ${error.message}`,
          prompt: "CSV manifest"
        });
        activeJob.failed += 1;
      }
    } finally {
      updateJob({ currentDownloadId: null });
    }
  }

  updateJob({
    running: false,
    current: activeJob.cancelRequested ? "Stopped" : "Done",
    currentDownloadId: null,
    finishedAt: new Date().toISOString()
  });
  activeAbortController = null;
  await saveJobHistory(activeJob);
}

async function resolvePromptForDownload(item, settings, tabId, signal) {
  if (!settings.embedMetadata || !tabId || item.promptSource !== "title" || !item.conversationId) {
    return item;
  }
  throwIfJobCancelled(signal);
  updateJob({ current: `Resolving prompt - ${item.title || item.prompt || item.url || "image"}` });
  try {
    const response = await withTimeout(sendTabMessage(tabId, {
      type: "GPTIMG_RESOLVE_PROMPTS",
      payload: {
        items: [item],
        maxConversations: 1,
        conversationConcurrency: 1,
        conversationDelayMs: 100,
        enrichmentTimeoutMs: 45000
      }
    }), 50000, signal);
    const resolved = response?.ok ? response.payload?.items?.[0] : null;
    return resolved?.prompt ? { ...item, ...resolved } : item;
  } catch (error) {
    if (isCancelError(error)) throw error;
    return item;
  }
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });
}

async function processImageItemWithRetries(item, oneBasedIndex, settings, tabId, signal) {
  let lastError = null;
  for (let attempt = 1; attempt <= settings.maxRetries + 1; attempt += 1) {
    throwIfJobCancelled(signal);
    updateJob({
      current: `${attempt}/${settings.maxRetries + 1} - ${item.prompt || item.url || "image"}`
    });
    try {
      return {
        ...await processImageItem(item, oneBasedIndex, settings, tabId, {
          signal,
          onDownloadId(downloadId) {
            updateJob({ currentDownloadId: downloadId || null });
          }
        }),
        attempts: attempt
      };
    } catch (error) {
      if (isCancelError(error) || isJobCancelled(signal)) throw createCancelError();
      lastError = error;
      if (attempt <= settings.maxRetries) {
        await sleep(Math.min(5000, 600 * attempt), signal);
      }
    } finally {
      updateJob({ currentDownloadId: null });
    }
  }
  throw lastError || new Error("Download failed.");
}

function withTimeout(promise, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelError());
      return;
    }
    const timer = setTimeout(() => reject(new Error("Timed out.")), timeoutMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createCancelError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise
      .then((value) => resolve(value))
      .catch((error) => reject(error))
      .finally(() => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      });
  });
}

async function cancelActiveJob() {
  if (!activeJob) return { activeJob: null };
  activeJob.cancelRequested = true;
  activeJob.current = activeJob.running ? "Stopping" : activeJob.current;
  activeAbortController?.abort();
  if (activeJob.currentDownloadId) {
    try {
      await chrome.downloads.cancel(activeJob.currentDownloadId);
    } catch {
      // The download may already be complete or interrupted.
    }
  }
  broadcastProgress();
  return { activeJob: summarizeJob(activeJob) };
}

async function retryFailed(payload = {}) {
  if (activeJob?.running) throw new Error("A download job is already running.");
  const history = await getJobHistory();
  const lastJob = history.jobs.find((job) => job.failed > 0);
  const failedItems = lastJob?.results?.filter((item) => {
    return item.status === "failed" && item.url;
  }) || [];
  if (!failedItems.length) throw new Error("No failed items are available to retry.");
  return startJob({
    items: failedItems,
    settings: payload.settings || lastJob.settings,
    tabId: payload.tabId || lastJob.tabId
  });
}

function summarizeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    running: job.running,
    cancelRequested: job.cancelRequested,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    skipped: job.skipped || 0,
    current: job.current,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt || "",
    settings: job.settings || null,
    results: (job.results || []).slice(-20)
  };
}

function updateJob(patch = {}) {
  if (activeJob) Object.assign(activeJob, patch);
  broadcastProgress();
}

function broadcastProgress() {
  chrome.runtime.sendMessage({
    type: "GPTIMG_PROGRESS",
    payload: { activeJob: summarizeJob(activeJob) }
  }).catch(() => {});
}

async function saveJobHistory(job) {
  if (!job) return;
  const { jobs = [] } = await getJobHistory();
  const saved = summarizeJob(job);
  const nextJobs = [saved, ...jobs.filter((entry) => entry.id !== saved.id)]
    .slice(0, JOB_HISTORY_LIMIT);
  await chrome.storage.local.set({ jobHistory: nextJobs });
}

async function getJobHistory() {
  const stored = await chrome.storage.local.get("jobHistory");
  return { jobs: Array.isArray(stored.jobHistory) ? stored.jobHistory : [] };
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(createCancelError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(createCancelError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function isJobCancelled(signal) {
  return Boolean(activeJob?.cancelRequested || signal?.aborted);
}

function throwIfJobCancelled(signal) {
  if (isJobCancelled(signal)) throw createCancelError();
}

function createCancelError() {
  const error = new Error("Download job was stopped.");
  error.name = "AbortError";
  return error;
}

function isCancelError(error) {
  return error?.name === "AbortError"
    || /abort|cancel|stop|stopped|cancelled|canceled/iu.test(error?.message || "");
}
