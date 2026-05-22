import {
  DEFAULT_SETTINGS,
  buildDownloadFilename,
  makeManifestCsv,
  normalizeSettings,
  truncateText
} from "./lib/file-utils.js";

const state = {
  tab: null,
  settings: DEFAULT_SETTINGS,
  items: [],
  selected: new Set(),
  filterText: "",
  job: null,
  history: []
};

const els = {
  pageStatus: document.querySelector("#pageStatus"),
  imageCount: document.querySelector("#imageCount"),
  selectedCount: document.querySelector("#selectedCount"),
  progressCount: document.querySelector("#progressCount"),
  scanPage: document.querySelector("#scanPage"),
  deepScan: document.querySelector("#deepScan"),
  selectAll: document.querySelector("#selectAll"),
  selectNone: document.querySelector("#selectNone"),
  openOptions: document.querySelector("#openOptions"),
  folderName: document.querySelector("#folderName"),
  delayMs: document.querySelector("#delayMs"),
  maxRetries: document.querySelector("#maxRetries"),
  embedMetadata: document.querySelector("#embedMetadata"),
  manifestAfterDownload: document.querySelector("#manifestAfterDownload"),
  filterText: document.querySelector("#filterText"),
  jobPanel: document.querySelector("#jobPanel"),
  jobText: document.querySelector("#jobText"),
  progressBar: document.querySelector("#progressBar"),
  cancelJob: document.querySelector("#cancelJob"),
  downloadSelected: document.querySelector("#downloadSelected"),
  exportManifest: document.querySelector("#exportManifest"),
  retryFailed: document.querySelector("#retryFailed"),
  emptyState: document.querySelector("#emptyState"),
  imageList: document.querySelector("#imageList")
};

const chromeApi = globalThis.chrome;
const isExtensionContext = Boolean(chromeApi?.runtime?.id && chromeApi?.tabs);

document.addEventListener("DOMContentLoaded", isExtensionContext ? init : initPreview);
els.scanPage.addEventListener("click", () => isExtensionContext ? scan(false) : loadPreviewItems());
els.deepScan.addEventListener("click", () => isExtensionContext ? scan(true) : loadPreviewItems());
els.selectAll.addEventListener("click", selectAll);
els.selectNone.addEventListener("click", selectNone);
els.downloadSelected.addEventListener("click", startDownload);
els.exportManifest.addEventListener("click", exportManifest);
els.retryFailed.addEventListener("click", retryFailed);
els.cancelJob.addEventListener("click", cancelJob);
els.openOptions.addEventListener("click", () => {
  if (isExtensionContext) chrome.runtime.openOptionsPage();
  else window.location.href = "options.html";
});
els.folderName.addEventListener("change", saveQuickSettings);
els.delayMs.addEventListener("change", saveQuickSettings);
els.maxRetries.addEventListener("change", saveQuickSettings);
els.embedMetadata.addEventListener("change", saveQuickSettings);
els.manifestAfterDownload.addEventListener("change", saveQuickSettings);
els.filterText.addEventListener("input", () => {
  state.filterText = els.filterText.value.trim().toLowerCase();
  render();
});

if (isExtensionContext) {
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "GPTIMG_PROGRESS") {
      state.job = message.payload.activeJob;
      render();
    }
    if (message?.type === "GPTIMG_SCAN_PROGRESS") {
      els.pageStatus.textContent = `스캔 중 · ${message.payload.found}개 발견`;
    }
  });
}

async function init() {
  const stored = await chrome.storage.local.get("settings");
  state.settings = normalizeSettings(stored.settings || DEFAULT_SETTINGS);
  state.tab = await getActiveTab();
  applySettingsToForm();
  await refreshJob();
  await refreshHistory();
  updatePageStatus();
  render();
}

function initPreview() {
  state.settings = normalizeSettings(DEFAULT_SETTINGS);
  applySettingsToForm();
  loadPreviewItems();
  els.pageStatus.textContent = "미리보기 모드";
  els.downloadSelected.disabled = true;
  els.exportManifest.disabled = true;
}

function loadPreviewItems() {
  state.items = [
    previewItem(1, "네온 조명의 제품 사진, 검은 배경, 반사광 강조"),
    previewItem(2, "화이트 스튜디오에서 촬영한 미니멀 앱 아이콘 세트"),
    previewItem(3, "한국어 제목이 들어간 미래형 앨범 커버 시안")
  ];
  state.selected = new Set(state.items.map((item) => item.id));
  render();
}

async function scan(deep) {
  await ensureContentScript();
  const imagesPage = /\/images\/?/u.test(state.tab?.url || "");
  const galleryScan = imagesPage
    ? { maxItems: 5000, maxPages: 80, limit: 100, loadedOnly: !deep }
    : { maxItems: deep ? 5000 : 150, maxPages: deep ? 80 : 1, limit: 100 };
  setBusy(true, deep
    ? (imagesPage ? "내 이미지 전체를 불러오는 중" : "전체 대화를 스크롤하며 스캔 중")
    : (imagesPage ? "현재 로드된 이미지만 스캔 중" : "현재 화면 스캔 중"));
  try {
    const response = await sendToTab(deep ? "GPTIMG_DEEP_SCAN" : "GPTIMG_SCAN", {
      maxSteps: 260,
      delayMs: 420,
      ...galleryScan,
      maxConversations: deep ? 500 : 8,
      conversationConcurrency: deep ? 2 : 1,
      conversationDelayMs: deep ? 250 : 150,
      enrichmentTimeoutMs: deep ? 600000 : 60000,
      enrichPrompts: false
    });
    state.items = response.items || [];
    state.selected = new Set(state.items.map((item) => item.id));
    els.pageStatus.textContent = `${state.items.length}개 이미지를 찾았습니다`;
  } catch (error) {
    els.pageStatus.textContent = error.message;
  } finally {
    setBusy(false);
    render();
  }
}

async function startDownload() {
  if (!isExtensionContext) return;
  const selectedItems = getSelectedItems();
  if (!selectedItems.length) return;
  const settings = readSettingsFromForm();
  await chrome.storage.local.set({ settings });
  const response = await chrome.runtime.sendMessage({
    type: "GPTIMG_START_DOWNLOADS",
    payload: { items: selectedItems, settings, tabId: state.tab.id }
  });
  if (!response.ok) {
    els.pageStatus.textContent = response.error;
    return;
  }
  state.job = response.payload.activeJob;
  render();
}

async function resolveSelectedPrompts(items) {
  if (!/\/images\/?/u.test(state.tab?.url || "")) return items;
  if (!items.some((item) => item.promptSource === "title" && item.conversationId)) return items;
  setBusy(true, "프롬프트 복원 중");
  try {
    const response = await sendToTab("GPTIMG_RESOLVE_PROMPTS", {
      items,
      maxConversations: Math.max(1, items.length),
      conversationConcurrency: 2,
      conversationDelayMs: 250,
      enrichmentTimeoutMs: 900000
    });
    const byId = new Map((response.items || []).map((item) => [item.id, item]));
    state.items = state.items.map((item) => byId.get(item.id) || item);
    return items.map((item) => byId.get(item.id) || item);
  } catch (error) {
    els.pageStatus.textContent = `프롬프트 복원 일부 실패: ${error.message}`;
    return items;
  } finally {
    setBusy(false);
    render();
  }
}

async function exportManifest() {
  if (!isExtensionContext) return;
  const settings = readSettingsFromForm();
  const resolvedItems = await resolveSelectedPrompts(getSelectedItems());
  const rows = resolvedItems.map((item, index) => ({
    ...item,
    filename: buildDownloadFilename(settings, item, index + 1, "png")
  }));
  const csv = makeManifestCsv(rows);
  await chrome.runtime.sendMessage({
    type: "GPTIMG_DOWNLOAD_TEXT",
    payload: {
      text: csv,
      filename: `${settings.folderName}/manifest-preview.csv`,
      mime: "text/csv;charset=utf-8",
      timeoutMs: settings.downloadTimeoutMs
    }
  });
}

async function retryFailed() {
  if (!isExtensionContext) return;
  const settings = readSettingsFromForm();
  const response = await chrome.runtime.sendMessage({
    type: "GPTIMG_RETRY_FAILED",
    payload: { settings, tabId: state.tab.id }
  });
  if (!response.ok) {
    els.pageStatus.textContent = response.error;
    return;
  }
  state.job = response.payload.activeJob;
  render();
}

async function cancelJob() {
  if (!isExtensionContext) return;
  const response = await chrome.runtime.sendMessage({ type: "GPTIMG_CANCEL_DOWNLOADS" });
  if (response.ok) state.job = response.payload.activeJob;
  render();
}

function render() {
  const selectedCount = state.selected.size;
  els.imageCount.textContent = String(state.items.length);
  els.selectedCount.textContent = String(selectedCount);
  els.downloadSelected.disabled = !isExtensionContext || selectedCount === 0 || Boolean(state.job?.running);
  els.exportManifest.disabled = !isExtensionContext || selectedCount === 0;
  els.retryFailed.disabled = !isExtensionContext || !hasFailedJobItems() || Boolean(state.job?.running);
  els.cancelJob.disabled = !isExtensionContext || !state.job?.running || Boolean(state.job?.cancelRequested);
  renderJob();
  renderList();
}

function renderJob() {
  const job = state.job;
  const total = job?.total || 0;
  const done = job ? job.completed + job.failed : 0;
  const percent = total ? Math.round((done / total) * 100) : 0;
  els.progressCount.textContent = `${percent}%`;
  els.progressBar.style.width = `${percent}%`;
  els.jobPanel.hidden = !job;
  if (!job) return;
  if (job.running) {
    const label = job.cancelRequested ? "Stopping" : truncateText(job.current, 48);
    els.jobText.textContent = `${done}/${total} - failed ${job.failed} - skipped ${job.skipped || 0} - ${label}`;
    return;
  }
  const finalLabel = job.cancelRequested ? "stopped" : "complete";
  els.jobText.textContent = `${done}/${total} ${finalLabel} - failed ${job.failed} - skipped ${job.skipped || 0}`;
  return;
  els.jobText.textContent = job.running
    ? `${done}/${total} · 실패 ${job.failed} · ${truncateText(job.current, 48)}`
    : `${done}/${total} 완료 · 실패 ${job.failed}`;
}

function renderList() {
  els.emptyState.hidden = state.items.length > 0;
  els.imageList.replaceChildren();
  const fragment = document.createDocumentFragment();
  const filteredItems = getFilteredItems();
  const visibleItems = filteredItems.slice(0, 240);

  for (const item of visibleItems) {
    const row = document.createElement("article");
    row.className = "image-row";
    row.dataset.id = item.id;
    row.innerHTML = `
      <label class="row-check">
        <input type="checkbox" ${state.selected.has(item.id) ? "checked" : ""}>
      </label>
      <img src="${escapeAttribute(item.url)}" alt="">
      <div class="row-main">
        <textarea spellcheck="false">${escapeHtml(item.prompt || item.alt || "")}</textarea>
        <p>${item.width || "?"}×${item.height || "?"}</p>
      </div>
    `;
    row.querySelector("input").addEventListener("change", (event) => {
      if (event.target.checked) state.selected.add(item.id);
      else state.selected.delete(item.id);
      render();
    });
    row.querySelector("textarea").addEventListener("change", (event) => {
      item.prompt = event.target.value.trim();
    });
    fragment.append(row);
  }

  if (filteredItems.length > visibleItems.length) {
    const more = document.createElement("p");
    more.className = "more-row";
    more.textContent = `${filteredItems.length - visibleItems.length}개는 성능을 위해 목록에서 접었습니다. 다운로드에는 포함됩니다.`;
    fragment.append(more);
  }
  els.imageList.append(fragment);
}

function selectAll() {
  state.selected = new Set(state.items.map((item) => item.id));
  render();
}

function selectNone() {
  state.selected.clear();
  render();
}

function getSelectedItems() {
  return state.items.filter((item) => state.selected.has(item.id));
}

function getFilteredItems() {
  if (!state.filterText) return state.items;
  return state.items.filter((item) => {
    const haystack = `${item.prompt || ""} ${item.alt || ""} ${item.url || ""}`.toLowerCase();
    return haystack.includes(state.filterText);
  });
}

function hasFailedJobItems() {
  return Boolean(
    state.job?.results?.some((item) => item.status === "failed")
      || state.history.some((job) => job.results?.some((item) => item.status === "failed"))
  );
}

async function saveQuickSettings() {
  state.settings = readSettingsFromForm();
  if (!isExtensionContext) return;
  await chrome.storage.local.set({ settings: state.settings });
}

function readSettingsFromForm() {
  return normalizeSettings({
    ...state.settings,
    folderName: els.folderName.value,
    delayMs: els.delayMs.value,
    maxRetries: els.maxRetries.value,
    embedMetadata: els.embedMetadata.checked,
    manifestAfterDownload: els.manifestAfterDownload.checked
  });
}

function applySettingsToForm() {
  els.folderName.value = state.settings.folderName;
  els.delayMs.value = state.settings.delayMs;
  els.maxRetries.value = state.settings.maxRetries;
  els.embedMetadata.checked = state.settings.embedMetadata;
  els.manifestAfterDownload.checked = state.settings.manifestAfterDownload;
}

async function refreshJob() {
  const response = await chrome.runtime.sendMessage({ type: "GPTIMG_GET_STATUS" });
  if (response.ok) state.job = response.payload.activeJob;
}

async function refreshHistory() {
  const response = await chrome.runtime.sendMessage({ type: "GPTIMG_GET_HISTORY" });
  if (response.ok) state.history = response.payload.jobs || [];
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const active = tabs[0] || null;
  if (isChatGptUrl(active?.url)) return active;
  const chatTabs = await chrome.tabs.query({
    url: ["https://chatgpt.com/*", "https://chat.openai.com/*"]
  });
  return chatTabs[0] || active;
}

async function ensureContentScript() {
  if (!state.tab?.id) throw new Error("활성 탭을 찾을 수 없습니다.");
  try {
    const ping = await sendToTab("GPTIMG_PING");
    if (/\/images\/?/u.test(state.tab?.url || "") && !ping.gallery) {
      throw new Error("Images gallery scanner is not loaded.");
    }
  } catch (error) {
    if (!/receiving end|could not establish connection|gallery scanner/iu.test(error.message)) {
      throw error;
    }
    await chrome.scripting.executeScript({
      target: { tabId: state.tab.id },
      files: ["src/content-gallery.js", "src/content.js"]
    });
  }
}

async function sendToTab(type, payload = {}) {
  const response = await chrome.tabs.sendMessage(state.tab.id, { type, payload });
  if (!response?.ok) throw new Error(response?.error || "탭 응답을 받지 못했습니다.");
  return response.payload;
}

function updatePageStatus() {
  if (!isChatGptUrl(state.tab?.url)) {
    els.pageStatus.textContent = "ChatGPT 탭에서 실행하세요";
    els.scanPage.disabled = true;
    els.deepScan.disabled = true;
    return;
  }
  els.pageStatus.textContent = "스캔 준비 완료";
}

function setBusy(busy, label = "작업 중") {
  els.scanPage.disabled = busy;
  els.deepScan.disabled = busy;
  els.pageStatus.textContent = busy ? label : els.pageStatus.textContent;
}

function previewItem(index, prompt) {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 120 120'><rect width='120' height='120' rx='12' fill='#111827'/><rect x='${18 + index * 4}' y='18' width='58' height='58' rx='8' fill='#176bff'/><circle cx='${72 + index * 4}' cy='72' r='24' fill='#31d0aa' opacity='.9'/></svg>`;
  return { id: `preview-${index}`, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`, prompt, alt: prompt, width: 1024, height: 1024, pageUrl: "https://chatgpt.com/", conversationTitle: "Preview" };
}

function isChatGptUrl(url) {
  return /^https:\/\/(chatgpt\.com|chat\.openai\.com)\//u.test(url || "");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/gu, "&#39;");
}
