import { DEFAULT_SETTINGS, normalizeSettings } from "./lib/file-utils.js";

const form = document.querySelector("#settingsForm");
const savedState = document.querySelector("#savedState");
const fields = {
  folderName: document.querySelector("#folderName"),
  filenameTemplate: document.querySelector("#filenameTemplate"),
  delayMs: document.querySelector("#delayMs"),
  maxRetries: document.querySelector("#maxRetries"),
  downloadTimeoutMs: document.querySelector("#downloadTimeoutMs"),
  embedMetadata: document.querySelector("#embedMetadata"),
  manifestAfterDownload: document.querySelector("#manifestAfterDownload"),
  jsonSidecar: document.querySelector("#jsonSidecar"),
  allowOriginalFallback: document.querySelector("#allowOriginalFallback")
};
const chromeApi = globalThis.chrome;
const isExtensionContext = Boolean(chromeApi?.runtime?.id && chromeApi?.storage);

document.addEventListener("DOMContentLoaded", loadSettings);
form.addEventListener("submit", saveSettings);
document.querySelector("#resetSettings").addEventListener("click", async () => {
  applySettings(DEFAULT_SETTINGS);
  if (isExtensionContext) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
  flashSaved("기본값으로 복원했습니다.");
});

async function loadSettings() {
  if (!isExtensionContext) {
    applySettings(DEFAULT_SETTINGS);
    return;
  }
  const stored = await chrome.storage.local.get("settings");
  applySettings(normalizeSettings(stored.settings || DEFAULT_SETTINGS));
}

async function saveSettings(event) {
  event.preventDefault();
  const settings = readSettings();
  if (isExtensionContext) {
    await chrome.storage.local.set({ settings });
  }
  flashSaved("저장했습니다.");
}

function readSettings() {
  return normalizeSettings({
    folderName: fields.folderName.value,
    filenameTemplate: fields.filenameTemplate.value,
    delayMs: fields.delayMs.value,
    maxRetries: fields.maxRetries.value,
    downloadTimeoutMs: fields.downloadTimeoutMs.value,
    embedMetadata: fields.embedMetadata.checked,
    manifestAfterDownload: fields.manifestAfterDownload.checked,
    jsonSidecar: fields.jsonSidecar.checked,
    allowOriginalFallback: fields.allowOriginalFallback.checked
  });
}

function applySettings(settings) {
  fields.folderName.value = settings.folderName;
  fields.filenameTemplate.value = settings.filenameTemplate;
  fields.delayMs.value = settings.delayMs;
  fields.maxRetries.value = settings.maxRetries;
  fields.downloadTimeoutMs.value = settings.downloadTimeoutMs;
  fields.embedMetadata.checked = settings.embedMetadata;
  fields.manifestAfterDownload.checked = settings.manifestAfterDownload;
  fields.jsonSidecar.checked = settings.jsonSidecar;
  fields.allowOriginalFallback.checked = settings.allowOriginalFallback;
}

function flashSaved(text) {
  savedState.textContent = text;
  setTimeout(() => {
    savedState.textContent = "";
  }, 2200);
}
