(() => {
  if (globalThis.GPTIMG_GALLERY?.scan) return;

  const RECENT_ENDPOINT = "/backend-api/my/recent/image_gen";
  const SESSION_ENDPOINT = "/api/auth/session";
  const STORAGE_KEYS = ["oai/apps/recentImages"];
  const conversationCache = new Map();
  let nextApiFetchAt = 0;

  globalThis.GPTIMG_GALLERY = { scan: scanImagesGallery, resolve: resolveGalleryPrompts };

  async function scanImagesGallery(options = {}) {
    const full = Boolean(options.full);
    const maxItems = clamp(options.maxItems, 1, 10000, 5000);
    const maxPages = clamp(options.maxPages, 1, 200, 80);
    const limit = clamp(options.limit, 1, 100, full ? 100 : Math.min(100, maxItems));
    const loadedOnly = options.loadedOnly === true;
    const token = await getAccessToken().catch(() => "");
    let items = [];

    if (loadedOnly) {
      items = visibleGalleryItems().slice(0, maxItems);
      if (token && items.length) {
        items = await hydrateLoadedItems(items, { token, maxPages, limit });
      }
    } else if (token) {
      items = await fetchRecentItems({ token, maxItems, maxPages, limit });
    }
    if (!items.length) items = readStoredRecentImages();

    items = loadedOnly ? items.slice(0, maxItems) : mergeWithVisibleGallery(items).slice(0, maxItems);
    if (token && items.length && options.enrichPrompts === true) {
      await enrichPrompts(items, token, {
        maxConversations: clamp(options.maxConversations, 1, 500, full ? 500 : 8),
        concurrency: clamp(options.conversationConcurrency, 1, 6, full ? 2 : 2),
        delayMs: clamp(options.conversationDelayMs, 0, 1000, full ? 250 : 100),
        maxMs: clamp(options.enrichmentTimeoutMs, 5000, 900000, full ? 600000 : 180000)
      });
    }

    const normalized = dedupeById(items.map(normalizeRecentItem).filter(Boolean));
    return {
      items: normalized,
      pageUrl: location.href,
      title: document.title,
      galleryMode: true,
      loadedOnly,
      promptResolved: normalized.filter((item) => item.promptSource !== "title").length
    };
  }

  async function getAccessToken() {
    const response = await fetch(SESSION_ENDPOINT, { credentials: "include", cache: "no-store" });
    if (!response.ok) throw new Error(`Session request failed: HTTP ${response.status}`);
    const session = await response.json();
    return session.accessToken || session.access_token || "";
  }

  async function fetchRecentItems({ token, maxItems, maxPages, limit }) {
    const output = [];
    let cursor = "";
    for (let page = 0; page < maxPages && output.length < maxItems; page += 1) {
      const url = new URL(RECENT_ENDPOINT, location.origin);
      url.searchParams.set("limit", String(Math.min(limit, maxItems - output.length)));
      if (cursor) url.searchParams.set("after", cursor);
      const payload = await fetchJsonWithToken(url.href, token);
      const pageItems = Array.isArray(payload.items) ? payload.items : [];
      output.push(...pageItems);
      emitProgress(output.length, page + 1, maxPages);
      cursor = payload.cursor || "";
      if (!cursor || !pageItems.length) break;
    }
    return output;
  }

  async function fetchJsonWithToken(url, token, attempts = 6) {
    let lastError = null;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      if (nextApiFetchAt > Date.now()) await wait(nextApiFetchAt - Date.now());
      const response = await fetch(url, {
        credentials: "include",
        cache: "no-store",
        headers: { authorization: `Bearer ${token}` }
      });
      if (response.ok) return response.json();
      lastError = new Error(`ChatGPT image API failed: HTTP ${response.status}`);
      if (!shouldRetryStatus(response.status) || attempt === attempts) break;
      const delayMs = retryDelayFor(response, attempt);
      nextApiFetchAt = Math.max(nextApiFetchAt, Date.now() + delayMs);
      await wait(delayMs);
    }
    throw lastError || new Error("ChatGPT image API failed.");
  }

  function readStoredRecentImages() {
    const items = [];
    for (const key of STORAGE_KEYS) {
      const parsed = safeJsonParse(localStorage.getItem(key));
      if (Array.isArray(parsed?.items)) items.push(...parsed.items);
    }
    return items;
  }

  function mergeWithVisibleGallery(apiItems) {
    const map = new Map();
    for (const item of apiItems) {
      const id = fileIdForRecentItem(item) || item.id;
      if (id) map.set(id, item);
    }
    for (const image of visibleGalleryImages()) {
      const id = fileIdFromUrl(image.currentSrc || image.src || "");
      if (!id || map.has(id)) continue;
      map.set(id, {
        id,
        url: sourceUrlFromThumbnail(image.currentSrc || image.src || ""),
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        title: cleanTitleFromImage(image),
        prompt: "",
        source: "chatgpt",
        encodings: { thumbnail: { path: image.currentSrc || image.src || "" } }
      });
    }
    return Array.from(map.values());
  }

  async function hydrateLoadedItems(loadedItems, { token, maxPages, limit }) {
    const byFileId = new Map();
    for (const item of loadedItems) {
      const fileId = fileIdForRecentItem(item);
      if (fileId) byFileId.set(fileId, item);
    }
    if (!byFileId.size) return loadedItems;

    const matched = new Map();
    let cursor = "";
    for (let page = 0; page < maxPages && matched.size < byFileId.size; page += 1) {
      const url = new URL(RECENT_ENDPOINT, location.origin);
      url.searchParams.set("limit", String(limit));
      if (cursor) url.searchParams.set("after", cursor);
      const payload = await fetchJsonWithToken(url.href, token);
      const pageItems = Array.isArray(payload.items) ? payload.items : [];
      for (const apiItem of pageItems) {
        const fileId = fileIdForRecentItem(apiItem);
        if (fileId && byFileId.has(fileId)) matched.set(fileId, apiItem);
      }
      emitProgress(matched.size, page + 1, maxPages);
      cursor = payload.cursor || "";
      if (!cursor || !pageItems.length) break;
    }

    return loadedItems.map((item) => {
      const fileId = fileIdForRecentItem(item);
      return matched.has(fileId) ? { ...item, ...matched.get(fileId), loadedFromDom: true } : item;
    });
  }

  function visibleGalleryItems() {
    return visibleGalleryImages().map((image) => {
      const thumbnailUrl = image.currentSrc || image.src || "";
      const url = sourceUrlFromThumbnail(thumbnailUrl);
      const fileId = fileIdFromUrl(url);
      return {
        id: fileId || stableId(url),
        url,
        thumbnail: thumbnailUrl,
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
        title: cleanTitleFromImage(image),
        prompt: "",
        source: "chatgpt",
        asset_pointer: fileId ? `sediment://${fileId}` : "",
        encodings: { thumbnail: { path: thumbnailUrl } },
        loadedFromDom: true
      };
    });
  }

  function visibleGalleryImages() {
    return Array.from(document.images).filter((image) => {
      const url = image.currentSrc || image.src || "";
      return /\/backend-api\/estuary\/content/iu.test(url) && !url.startsWith("data:");
    });
  }

  function normalizeRecentItem(item) {
    const thumbnailUrl = item.thumbnail || item.encodings?.thumbnail?.path || "";
    const sourceUrl = item.url || item.encodings?.source?.path || item.encodings?.source_wm?.path
      || sourceUrlFromThumbnail(thumbnailUrl);
    if (!sourceUrl) return null;
    const title = cleanText(item.title || item.alt || "");
    const prompt = cleanText(item.resolvedPrompt || item.prompt || item.recreation_prompt || title);
    const fileId = fileIdForRecentItem(item) || fileIdFromUrl(sourceUrl);
    return {
      id: item.id || fileId || stableId(sourceUrl),
      url: sourceUrl,
      thumbnailUrl,
      prompt,
      promptSource: item.resolvedPromptSource || item.promptSource || (item.prompt ? "api_prompt" : "title"),
      alt: title,
      width: item.width || item.encodings?.source?.width || item.encodings?.thumbnail?.width || null,
      height: item.height || item.encodings?.source?.height || item.encodings?.thumbnail?.height || null,
      pageUrl: location.href,
      conversationTitle: cleanText(document.title),
      title,
      createdAt: isoFromSeconds(item.created_at),
      conversationId: item.conversation_id || item.conversationId || "",
      messageId: item.message_id || item.messageId || "",
      transformationId: item.transformation_id || item.transformationId || "",
      assetPointer: item.asset_pointer || item.assetPointer || "",
      fileId,
      visible: true
    };
  }

  async function resolveGalleryPrompts(inputItems, options = {}) {
    const token = await getAccessToken().catch(() => "");
    const items = Array.isArray(inputItems) ? inputItems.map((item) => ({ ...item })) : [];
    if (!token || !items.length) return { items, promptResolved: 0 };
    await enrichPrompts(items, token, {
      maxConversations: clamp(options.maxConversations, 1, 1000, 1000),
      concurrency: clamp(options.conversationConcurrency, 1, 4, 2),
      delayMs: clamp(options.conversationDelayMs, 0, 2000, 250),
      maxMs: clamp(options.enrichmentTimeoutMs, 5000, 1800000, 900000)
    });
    const normalized = dedupeById(items.map(normalizeRecentItem).filter(Boolean));
    return {
      items: normalized,
      promptResolved: normalized.filter((item) => item.promptSource !== "title").length
    };
  }

  async function enrichPrompts(items, token, options) {
    const groups = groupByConversation(items).slice(0, options.maxConversations);
    const startedAt = Date.now();
    let done = 0;
    await runLimited(groups, options.concurrency, async (group) => {
      if (Date.now() - startedAt > options.maxMs) return;
      try {
        const conversation = await fetchConversation(group.conversationId, token);
        for (const item of group.items) {
          const resolved = resolvePromptFromConversation(item, conversation);
          if (resolved.text) {
            item.resolvedPrompt = resolved.text;
            item.resolvedPromptSource = resolved.source;
          }
        }
      } catch {
        // Keep title fallback when a conversation is unavailable.
      } finally {
        done += 1;
        emitProgress(items.length, done, groups.length || 1);
        if (options.delayMs) await wait(options.delayMs);
      }
    });
  }

  async function fetchConversation(conversationId, token) {
    if (conversationCache.has(conversationId)) return conversationCache.get(conversationId);
    const url = `${location.origin}/backend-api/conversation/${encodeURIComponent(conversationId)}`;
    const request = fetchJsonWithToken(url, token).catch((error) => {
      conversationCache.delete(conversationId);
      throw error;
    });
    conversationCache.set(conversationId, request);
    return request;
  }

  function groupByConversation(items) {
    const map = new Map();
    for (const item of items) {
      const conversationId = item.conversation_id || item.conversationId;
      if (!conversationId) continue;
      if (!map.has(conversationId)) map.set(conversationId, []);
      map.get(conversationId).push(item);
    }
    return Array.from(map, ([conversationId, groupItems]) => ({ conversationId, items: groupItems }));
  }

  function resolvePromptFromConversation(item, conversation) {
    const mapping = conversation?.mapping || {};
    const nodes = Object.values(mapping).filter((node) => node?.message);
    const byMessageId = new Map(nodes.map((node) => [node.message.id, node]));
    const fileId = fileIdForRecentItem(item);
    let node = byMessageId.get(item.message_id || item.messageId)
      || nodes.find((entry) => messageText(entry.message).includes(fileId));
    let fallback = "";

    for (let depth = 0; node && depth < 120; depth += 1) {
      const message = node.message;
      const text = messageText(message);
      const marked = extractMarkedPrompt(text);
      if (marked) return { text: marked, source: "conversation_prompt_marker" };
      if (message.author?.role === "user" && cleanText(text).length > 0) {
        return { text: cleanText(text), source: "conversation_user" };
      }
      if (!fallback && /Scene-specific visual brief:/iu.test(text)) {
        fallback = extractSceneBrief(text);
      }
      node = mapping[node.parent] || byMessageId.get(message.metadata?.parent_id);
    }

    if (fallback) return { text: fallback, source: "conversation_scene_brief" };
    return nearestPromptBeforeItem(item, nodes);
  }

  function nearestPromptBeforeItem(item, nodes) {
    const created = Number(item.created_at || item.createdAt || 0);
    const before = nodes
      .map((node) => node.message)
      .filter((message) => !created || Number(message.create_time || 0) <= created + 5)
      .sort((a, b) => Number(b.create_time || 0) - Number(a.create_time || 0));
    for (const message of before) {
      const text = messageText(message);
      const marked = extractMarkedPrompt(text);
      if (marked) return { text: marked, source: "conversation_prompt_marker" };
      if (message.author?.role === "user" && cleanText(text).length > 0) {
        return { text: cleanText(text), source: "conversation_user" };
      }
    }
    return { text: "", source: "" };
  }

  function messageText(message) {
    const parts = message?.content?.parts || [];
    return parts.map((part) => {
      if (typeof part === "string") return part;
      return safeStringify(part);
    }).join("\n");
  }

  function extractMarkedPrompt(text) {
    const normalized = cleanPromptText(text);
    const marker = /\[(?:프롬프트|prompt)\]/giu;
    let match = null;
    for (const current of normalized.matchAll(marker)) match = current;
    if (!match) return "";
    return cleanPromptText(normalized.slice(match.index + match[0].length)).slice(0, 6000);
  }

  function extractSceneBrief(text) {
    const normalized = cleanPromptText(text);
    const index = normalized.search(/Scene-specific visual brief:/iu);
    return index >= 0 ? normalized.slice(index, index + 6000).trim() : "";
  }

  function cleanPromptText(value) {
    return String(value || "")
      .replace(/\r/gu, "")
      .split("\n")
      .map((line) => line.replace(/^\s*\d+\s*/u, ""))
      .join("\n")
      .replace(/Generated images from[\s\S]*$/iu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function sourceUrlFromThumbnail(url) {
    if (!url) return "";
    try {
      const parsed = new URL(url, location.href);
      const id = parsed.searchParams.get("id") || "";
      const fileId = decodeURIComponent(id).split("#").find((part) => part.startsWith("file_"));
      if (fileId) parsed.searchParams.set("id", fileId);
      return parsed.href;
    } catch {
      return url;
    }
  }

  function fileIdForRecentItem(item) {
    return fileIdFromAssetPointer(item.asset_pointer || item.assetPointer)
      || fileIdFromUrl(item.url)
      || fileIdFromUrl(item.thumbnail || item.encodings?.thumbnail?.path || "");
  }

  function fileIdFromAssetPointer(value) {
    const match = String(value || "").match(/file_[a-zA-Z0-9]+/u);
    return match?.[0] || "";
  }

  function fileIdFromUrl(url) {
    try {
      const id = new URL(url, location.href).searchParams.get("id") || "";
      return fileIdFromAssetPointer(decodeURIComponent(id));
    } catch {
      return fileIdFromAssetPointer(url);
    }
  }

  function cleanTitleFromImage(image) {
    const label = image.alt || image.closest("button,[aria-label]")?.getAttribute("aria-label") || "";
    return cleanText(label.replace(/^\d+\/\d+\s*이미지:\s*/u, "").replace(/^이미지 열기:\s*/u, ""));
  }

  function dedupeById(items) {
    const map = new Map();
    for (const item of items) {
      const key = item.fileId || item.assetPointer || item.id || item.url;
      if (!map.has(key)) map.set(key, item);
    }
    return Array.from(map.values());
  }

  function emitProgress(found, step, maxSteps) {
    chrome.runtime.sendMessage({
      type: "GPTIMG_SCAN_PROGRESS",
      payload: { found, step, maxSteps }
    }).catch(() => {});
  }

  async function runLimited(items, concurrency, worker) {
    let index = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index];
        index += 1;
        await worker(current);
      }
    }));
  }

  function safeJsonParse(value) {
    try {
      return JSON.parse(value || "null");
    } catch {
      return null;
    }
  }

  function safeStringify(value) {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }

  function isoFromSeconds(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? new Date(number * 1000).toISOString() : "";
  }

  function cleanText(value) {
    return String(value || "").replace(/\s+/gu, " ").trim();
  }

  function clamp(value, min, max, fallback) {
    const number = Number(value);
    if (!Number.isFinite(number)) return fallback;
    return Math.min(max, Math.max(min, Math.round(number)));
  }

  function stableId(value) {
    let hash = 0;
    for (const char of String(value || "")) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `gptimg-gallery-${hash.toString(36)}`;
  }

  function shouldRetryStatus(status) {
    return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
  }

  function retryDelayFor(response, attempt) {
    const retryAfter = Number(response.headers.get("retry-after"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) return retryAfter * 1000;
    if (response.status === 429) return [5000, 15000, 30000, 60000, 90000][Math.min(attempt - 1, 4)];
    return 1000 * attempt;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
})();
