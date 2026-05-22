import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.GPTIMG_CDP_PORT || 9241);
const extensionPath = process.env.GPTIMG_EXTENSION_PATH || path.join(projectRoot, "dist");
const artifactPath = process.env.GPTIMG_SMOKE_SCREENSHOT
  || path.join(projectRoot, "artifacts", "commercial-extension-page.png");

async function main() {
  const extId = await loadExtension();
  await reloadChatGptPage();
  const result = await runDirectSmoke(extId);
  console.log(JSON.stringify({ extId, ...result }, null, 2));
}

async function loadExtension() {
  const explicitId = process.env.GPTIMG_EXTENSION_ID?.trim();
  if (explicitId) return explicitId;

  const browser = await connect(await browserTarget());
  const current = await browser.send("Extensions.getExtensions");
  if (current.error) {
    browser.ws.close();
    throw new Error(`CDP Extensions domain is unavailable. Load the extension manually and rerun with GPTIMG_EXTENSION_ID. ${current.error.message}`);
  }
  const preloaded = (current.result?.extensions || []).find((ext) => {
    return ext.name === "GPT Image Bulk Downloader";
  });
  if (process.env.GPTIMG_EXTENSION_PRELOADED === "1" && preloaded?.id) {
    browser.ws.close();
    return preloaded.id;
  }
  for (const ext of current.result?.extensions || []) {
    if (ext.name === "GPT Image Bulk Downloader") {
      await browser.send("Extensions.uninstall", { id: ext.id });
    }
  }
  const loaded = await browser.send("Extensions.loadUnpacked", {
    path: extensionPath.replaceAll("\\", "/")
  });
  browser.ws.close();
  if (loaded.error) {
    if (preloaded?.id) return preloaded.id;
    throw new Error(loaded.error.message);
  }
  return loaded.result.id;
}

async function reloadChatGptPage() {
  const chat = await connect(await pageTarget((target) => {
    return target.url?.startsWith("https://chatgpt.com")
      || target.url?.startsWith("https://chat.openai.com");
  }));
  await chat.send("Page.enable");
  await chat.send("Page.reload", { ignoreCache: true });
  await wait(7000);
  chat.ws.close();
}

async function runDirectSmoke(extId) {
  const extensionTarget = await fetchJson(
    `http://127.0.0.1:${port}/json/new?chrome-extension://${extId}/popup.html`,
    { method: "PUT" }
  );
  const page = await connect(extensionTarget);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await wait(1000);

  const smoke = await page.send("Runtime.evaluate", {
    expression: `(${directSmokeSource})()`,
    awaitPromise: true,
    returnByValue: true,
    timeout: 240000
  });
  if (smoke.error) throw new Error(smoke.error.message);
  if (smoke.result.exceptionDetails) {
    throw new Error(smoke.result.exceptionDetails.exception?.description || "Smoke script failed.");
  }

  await mkdir(path.dirname(artifactPath), { recursive: true });
  const shot = await page.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false
  });
  await writeFile(artifactPath, Buffer.from(shot.result.data, "base64"));
  page.ws.close();
  return {
    screenshot: artifactPath,
    smoke: smoke.result.result.value
  };
}

const directSmokeSource = async function directSmoke() {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const chromeCall = (fn, ...args) => new Promise((resolve, reject) => {
    fn(...args, (value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(value);
    });
  });

  const tabs = await chromeCall(chrome.tabs.query, {
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  });
  const tab = tabs.find((entry) => entry.url && entry.url.includes("/images")) || tabs[0];
  if (!tab?.id) throw new Error("No ChatGPT tab is available for the smoke test.");

  const loadedScan = await chromeCall(chrome.tabs.sendMessage, tab.id, {
    type: "GPTIMG_SCAN",
    payload: { loadedOnly: true, maxItems: 5000, maxPages: 80, limit: 100 }
  });
  if (!loadedScan?.ok) throw new Error(loadedScan?.error || "Loaded ChatGPT scan failed.");
  const allScan = await chromeCall(chrome.tabs.sendMessage, tab.id, {
    type: "GPTIMG_DEEP_SCAN",
    payload: { loadedOnly: false, maxItems: 5000, maxPages: 80, limit: 100 }
  });
  if (!allScan?.ok) throw new Error(allScan?.error || "Full ChatGPT scan failed.");

  const loadedItems = loadedScan.payload?.items || [];
  const allItems = allScan.payload?.items || [];
  const loadedTemplateCount = loadedItems.filter((item) => /images-app\//u.test(item.url || "")).length;
  const allTemplateCount = allItems.filter((item) => /images-app\//u.test(item.url || "")).length;
  const loadedEstuaryCount = loadedItems.filter((item) => /\/backend-api\/estuary\/content/u.test(item.url || "")).length;
  const allEstuaryCount = allItems.filter((item) => /\/backend-api\/estuary\/content/u.test(item.url || "")).length;
  if (tab.url?.includes("/images") && loadedItems.length < 1) {
    throw new Error("Loaded-only image scan returned no images.");
  }
  if (tab.url?.includes("/images") && allItems.length < 400) {
    throw new Error(`Full images gallery scan returned only ${allItems.length}; expected at least 400.`);
  }
  if (tab.url?.includes("/images") && allItems.length <= loadedItems.length) {
    throw new Error(`Loaded-only scan was not separate from full scan: loaded=${loadedItems.length}, full=${allItems.length}.`);
  }
  if (loadedTemplateCount + allTemplateCount > 0) {
    throw new Error(`Images gallery scan included default template cards: loaded=${loadedTemplateCount}, full=${allTemplateCount}.`);
  }
  let items = loadedItems.filter((item) => item.url).slice(0, 1);
  if (!items.length) throw new Error("ChatGPT scan returned no downloadable images.");
  const settings = {
    folderName: "GPT Image Commercial Test/{date}",
    filenameTemplate: "{index}-{prompt}",
    delayMs: 50,
    maxRetries: 1,
    downloadTimeoutMs: 180000,
    embedMetadata: true,
    manifestAfterDownload: true,
    jsonSidecar: true,
    allowOriginalFallback: false
  };

  const start = await chromeCall(chrome.runtime.sendMessage, {
    type: "GPTIMG_START_DOWNLOADS",
    payload: { items, settings, tabId: tab.id }
  });
  if (!start?.ok) throw new Error(start?.error || "Download job did not start.");

  let status = null;
  for (let tick = 0; tick < 180; tick += 1) {
    const response = await chromeCall(chrome.runtime.sendMessage, { type: "GPTIMG_GET_STATUS" });
    if (!response?.ok) throw new Error(response?.error || "Could not read download status.");
    status = response.payload?.activeJob || null;
    if (status && !status.running) break;
    await sleep(1000);
  }

  if (!status || status.running) throw new Error("Download job did not finish in time.");
  const result = status.results?.find((entry) => entry.status === "complete");
  const manifest = status.results?.find((entry) => entry.prompt === "CSV manifest");
  if (!result?.prompt || result.promptSource === "title") {
    throw new Error("Download did not resolve prompt metadata before saving.");
  }
  const downloads = result?.downloadId
    ? await chromeCall(chrome.downloads.search, { id: result.downloadId })
    : [];
  const manifestDownloads = manifest?.downloadId
    ? await chromeCall(chrome.downloads.search, { id: manifest.downloadId })
    : [];
  const cancelSmoke = await runCancelSmoke(loadedItems.slice(1), tab.id);

  return {
    tab: { id: tab.id, title: tab.title, url: tab.url },
    loadedScannedCount: loadedItems.length,
    fullScannedCount: allItems.length,
    loadedEstuaryCount,
    fullEstuaryCount: allEstuaryCount,
    loadedTemplateCount,
    fullTemplateCount: allTemplateCount,
    downloadedCount: status.completed,
    failedCount: status.failed,
    firstPrompt: result?.prompt || items[0].prompt || items[0].alt || "",
    imageResult: result || null,
    manifestResult: manifest || null,
    chromeDownload: summarizeDownload(downloads[0]),
    manifestDownload: summarizeDownload(manifestDownloads[0]),
    cancelSmoke,
    status
  };

  async function runCancelSmoke(sourceItems, tabId) {
    const cancelItems = sourceItems.filter((item) => item.url).slice(0, 8);
    if (cancelItems.length < 2) {
      return { skipped: true, reason: "Not enough scanned images for cancel smoke." };
    }
    const cancelSettings = {
      folderName: "GPT Image Cancel Test/{date}",
      filenameTemplate: "cancel-{index}",
      delayMs: 5000,
      maxRetries: 0,
      downloadTimeoutMs: 180000,
      embedMetadata: false,
      manifestAfterDownload: false,
      jsonSidecar: false,
      allowOriginalFallback: true
    };

    const started = await chromeCall(chrome.runtime.sendMessage, {
      type: "GPTIMG_START_DOWNLOADS",
      payload: { items: cancelItems, settings: cancelSettings, tabId }
    });
    if (!started?.ok) throw new Error(started?.error || "Cancel smoke job did not start.");
    await sleep(100);
    const cancelled = await chromeCall(chrome.runtime.sendMessage, { type: "GPTIMG_CANCEL_DOWNLOADS" });
    if (!cancelled?.ok) throw new Error(cancelled?.error || "Cancel smoke request failed.");

    let cancelStatus = null;
    for (let tick = 0; tick < 60; tick += 1) {
      const response = await chromeCall(chrome.runtime.sendMessage, { type: "GPTIMG_GET_STATUS" });
      if (!response?.ok) throw new Error(response?.error || "Could not read cancelled job status.");
      cancelStatus = response.payload?.activeJob || null;
      if (cancelStatus && !cancelStatus.running) break;
      await sleep(500);
    }

    if (!cancelStatus || cancelStatus.running) throw new Error("Cancel smoke job did not stop.");
    if (!cancelStatus.cancelRequested) throw new Error("Cancel smoke job did not record cancelRequested.");
    if (cancelStatus.completed >= cancelItems.length) {
      throw new Error(`Cancel smoke completed every item before stopping: ${cancelStatus.completed}/${cancelItems.length}.`);
    }
    if (cancelStatus.failed > 0) {
      throw new Error(`Cancel smoke recorded failures instead of a clean stop: failed=${cancelStatus.failed}.`);
    }

    return {
      total: cancelStatus.total,
      completed: cancelStatus.completed,
      failed: cancelStatus.failed,
      skipped: cancelStatus.skipped,
      cancelRequested: cancelStatus.cancelRequested,
      current: cancelStatus.current
    };
  }

  function summarizeDownload(item) {
    if (!item) return null;
    return {
      id: item.id,
      state: item.state,
      danger: item.danger,
      exists: item.exists,
      filename: item.filename,
      fileSize: item.fileSize,
      mime: item.mime,
      endTime: item.endTime
    };
  }
};

async function browserTarget() {
  const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
  return { webSocketDebuggerUrl: version.webSocketDebuggerUrl };
}

async function pageTarget(filter) {
  const targets = await fetchJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find(filter) || targets.find((entry) => entry.type === "page");
  if (!target) throw new Error("No debuggable page target was found.");
  return target;
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = reject;
  });
  return {
    ws,
    send(method, params = {}) {
      return new Promise((resolve) => {
        const messageId = ++id;
        pending.set(messageId, resolve);
        ws.send(JSON.stringify({ id: messageId, method, params }));
      });
    }
  };
}

async function fetchJson(url, init) {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
