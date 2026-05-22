const listeners = new Set();
const events = [];
let downloadId = 0;
let cancelled = false;

URL.createObjectURL = undefined;
URL.revokeObjectURL = undefined;

globalThis.chrome = {
  downloads: {
    onChanged: {
      addListener(listener) {
        listeners.add(listener);
      },
      removeListener(listener) {
        listeners.delete(listener);
      }
    },
    async download({ filename }) {
      downloadId += 1;
      events.push(["download", downloadId, filename]);
      return downloadId;
    },
    async cancel(id) {
      cancelled = true;
      events.push(["cancel", id]);
      for (const listener of listeners) {
        listener({ id, state: { current: "interrupted" } });
      }
    },
    async search({ id }) {
      return [{
        id,
        state: cancelled ? "interrupted" : "in_progress",
        error: cancelled ? "USER_CANCELED" : "",
        filename: "mock-download.png"
      }];
    }
  }
};

const { processImageItem } = await import("../src/lib/download-engine.js");

const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
const controller = new AbortController();
const ids = [];
const promise = processImageItem({
  id: "cancel-smoke",
  url: pngDataUrl,
  prompt: "cancel smoke prompt",
  pageUrl: "https://chatgpt.com/images/",
  conversationTitle: "Cancel smoke"
}, 1, {
  folderName: "Smoke/{date}",
  filenameTemplate: "{index}-{prompt}",
  delayMs: 0,
  maxRetries: 0,
  downloadTimeoutMs: 60000,
  embedMetadata: false,
  manifestAfterDownload: false,
  jsonSidecar: false,
  allowOriginalFallback: true
}, 1, {
  signal: controller.signal,
  onDownloadId(id) {
    ids.push(id || null);
  }
});

await new Promise((resolve) => setTimeout(resolve, 25));
controller.abort();

let error = null;
try {
  await promise;
} catch (caught) {
  error = caught;
}

if (error?.name !== "AbortError") {
  throw new Error(`Expected AbortError, got ${error?.name || "no error"}: ${error?.message || ""}`);
}
if (!cancelled || !events.some((event) => event[0] === "cancel")) {
  throw new Error("Abort did not call chrome.downloads.cancel().");
}
if (!ids.includes(1) || ids.at(-1) !== null) {
  throw new Error(`Download ID lifecycle was not reported correctly: ${JSON.stringify(ids)}`);
}
if (listeners.size !== 0) {
  throw new Error("Download listener was not removed after cancellation.");
}

console.log(JSON.stringify({
  ok: true,
  errorName: error.name,
  events,
  downloadIds: ids
}, null, 2));
