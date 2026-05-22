(() => {
  if (globalThis.GPTIMG_CONTENT_READY) return;
  globalThis.GPTIMG_CONTENT_READY = true;

  const MESSAGE_SELECTORS = [
    "[data-message-author-role]",
    "[data-testid^='conversation-turn']",
    "article"
  ];
  const MIN_IMAGE_SIDE = 256;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    routeMessage(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  });

  async function routeMessage(message) {
    switch (message?.type) {
      case "GPTIMG_PING":
        return {
          ready: true,
          gallery: Boolean(globalThis.GPTIMG_GALLERY?.scan),
          version: "gallery-aware"
        };
      case "GPTIMG_SCAN":
        if (isImagesAppPage()) return scanImagesApp(false, message.payload);
        return scanPage();
      case "GPTIMG_DEEP_SCAN":
        if (isImagesAppPage()) return scanImagesApp(true, message.payload);
        return deepScan(message.payload);
      case "GPTIMG_RESOLVE_PROMPTS":
        if (isImagesAppPage()) return resolveImagesAppPrompts(message.payload);
        throw new Error("Prompt resolver is only available on ChatGPT Images.");
      case "GPTIMG_FETCH_AS_DATA_URL":
        return fetchAsDataUrl(message.payload?.url);
      default:
        throw new Error(`Unknown content message: ${message?.type || "missing"}`);
    }
  }

  function scanImagesApp(full, payload = {}) {
    if (!globalThis.GPTIMG_GALLERY?.scan) {
      throw new Error("Images gallery scanner is not loaded.");
    }
    return globalThis.GPTIMG_GALLERY.scan({ ...payload, full });
  }

  function resolveImagesAppPrompts(payload = {}) {
    if (!globalThis.GPTIMG_GALLERY?.resolve) {
      throw new Error("Images gallery prompt resolver is not loaded.");
    }
    return globalThis.GPTIMG_GALLERY.resolve(payload.items || [], payload);
  }

  function scanPage() {
    const blocks = collectMessageBlocks();
    const images = Array.from(document.images)
      .filter(isLikelyGeneratedImage)
      .map((image, index) => buildImageItem(image, blocks, index))
      .filter(Boolean);
    return {
      items: dedupeByUrl(images),
      pageUrl: location.href,
      title: document.title
    };
  }

  async function deepScan(options = {}) {
    const root = findScrollRoot();
    const originalTop = root.scrollTop;
    const maxSteps = Number(options.maxSteps || 220);
    const delayMs = Number(options.delayMs || 450);
    const seen = new Map();

    root.scrollTo({ top: 0, behavior: "instant" });
    await wait(delayMs);

    let lastTop = -1;
    for (let step = 0; step < maxSteps; step += 1) {
      for (const item of scanPage().items) seen.set(item.url, item);
      chrome.runtime.sendMessage({
        type: "GPTIMG_SCAN_PROGRESS",
        payload: { found: seen.size, step, maxSteps }
      }).catch(() => {});

      if (Math.abs(root.scrollTop - lastTop) < 2 && step > 0) break;
      lastTop = root.scrollTop;
      const nextTop = Math.min(root.scrollHeight, root.scrollTop + root.clientHeight * 0.82);
      root.scrollTo({ top: nextTop, behavior: "instant" });
      await wait(delayMs);
      if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
        for (const item of scanPage().items) seen.set(item.url, item);
        break;
      }
    }

    root.scrollTo({ top: originalTop, behavior: "instant" });
    return { items: Array.from(seen.values()), pageUrl: location.href, title: document.title };
  }

  async function fetchAsDataUrl(url) {
    if (!url) throw new Error("Missing image URL.");
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: HTTP ${response.status}`);
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return { dataUrl };
  }

  function buildImageItem(image, blocks, fallbackIndex) {
    const url = bestImageUrl(image);
    if (!url) return null;
    const prompt = findPromptForImage(image, blocks);
    const rect = image.getBoundingClientRect();
    const width = image.naturalWidth || Math.round(rect.width);
    const height = image.naturalHeight || Math.round(rect.height);
    return {
      id: stableId(url, fallbackIndex),
      url,
      prompt,
      alt: cleanText(image.alt || image.getAttribute("aria-label") || ""),
      width,
      height,
      pageUrl: location.href,
      conversationTitle: cleanTitle(document.title),
      visible: rect.bottom > 0 && rect.top < window.innerHeight
    };
  }

  function collectMessageBlocks() {
    const nodes = uniqueElements(MESSAGE_SELECTORS.flatMap((selector) => {
      return Array.from(document.querySelectorAll(selector));
    }));
    return nodes
      .filter((node) => cleanText(node.innerText).length > 0 || node.querySelector("img"))
      .map((node, index) => ({
        node,
        index,
        role: inferRole(node),
        text: cleanMessageText(node)
      }))
      .sort((a, b) => {
        if (a.node === b.node) return 0;
        return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_PRECEDING
          ? 1
          : -1;
      })
      .map((entry, index) => ({ ...entry, index }));
  }

  function findPromptForImage(image, blocks) {
    const block = blocks.find((entry) => entry.node.contains(image));
    if (!block) return nearbyTextPrompt(image);
    if (block.role === "user" && block.text) return block.text;

    const before = blocks
      .filter((entry) => entry.index < block.index || isBefore(entry.node, image))
      .filter((entry) => entry.role === "user" && entry.text.length > 0)
      .at(-1);
    if (before?.text) return before.text;
    return nearbyTextPrompt(image);
  }

  function nearbyTextPrompt(image) {
    const candidates = [];
    let cursor = image.parentElement;
    for (let depth = 0; cursor && depth < 6; depth += 1) {
      const text = cleanMessageText(cursor);
      if (text && !text.includes(image.alt || "__no_alt__")) candidates.push(text);
      cursor = cursor.parentElement;
    }
    return candidates.find((text) => text.length > 12) || image.alt || document.title || "";
  }

  function isLikelyGeneratedImage(image) {
    const url = bestImageUrl(image);
    if (!url || url.startsWith("chrome-extension:")) return false;
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (Math.max(width, height) < MIN_IMAGE_SIDE) return false;
    if (image.closest("nav, header, footer")) return false;
    if (/avatar|icon|sprite|emoji|logo/iu.test(`${url} ${image.alt}`)) return false;
    return /openai|oai|usercontent|blob:|dalle|image|files/iu.test(url)
      || /\/backend-api\/estuary\/content/iu.test(url)
      || image.closest("[data-message-author-role='assistant']");
  }

  function isImagesAppPage() {
    return /^https:\/\/chatgpt\.com\/images\/?/u.test(location.href);
  }

  function bestImageUrl(image) {
    if (image.currentSrc) return image.currentSrc;
    const srcset = image.getAttribute("srcset");
    if (srcset) {
      const candidates = srcset.split(",")
        .map((part) => part.trim().split(/\s+/u))
        .map(([url, size]) => ({ url, width: Number.parseInt(size, 10) || 0 }))
        .sort((a, b) => b.width - a.width);
      if (candidates[0]?.url) return new URL(candidates[0].url, location.href).href;
    }
    return image.src ? new URL(image.src, location.href).href : "";
  }

  function inferRole(node) {
    const attr = node.getAttribute("data-message-author-role");
    if (attr === "user" || attr === "assistant") return attr;
    const testId = node.getAttribute("data-testid") || "";
    if (/user/iu.test(testId)) return "user";
    if (/assistant|bot|response/iu.test(testId)) return "assistant";
    const label = node.getAttribute("aria-label") || "";
    if (/you|user|사용자|나/iu.test(label)) return "user";
    if (/chatgpt|assistant|gpt|응답/iu.test(label)) return "assistant";
    return node.querySelector("img") ? "assistant" : "unknown";
  }

  function cleanMessageText(node) {
    const clone = node.cloneNode(true);
    clone.querySelectorAll("button, svg, img, canvas, video, style, script").forEach((el) => el.remove());
    return cleanText(clone.innerText);
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\b(Copy|Edit|Share|Download|Retry|Like|Dislike)\b/giu, " ")
      .replace(/(복사|편집|공유|다운로드|다시 생성|좋아요|싫어요)/gu, " ")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function cleanTitle(value) {
    return cleanText(String(value || "").replace(/ - ChatGPT$/iu, "")) || "ChatGPT";
  }

  function dedupeByUrl(items) {
    const map = new Map();
    for (const item of items) {
      if (!map.has(item.url)) map.set(item.url, item);
    }
    return Array.from(map.values());
  }

  function uniqueElements(nodes) {
    return Array.from(new Set(nodes)).filter((node) => node instanceof Element);
  }

  function findScrollRoot() {
    const candidates = [
      document.scrollingElement,
      ...Array.from(document.querySelectorAll("main, [class*='overflow'], [data-radix-scroll-area-viewport]"))
    ].filter(Boolean);
    return candidates.reduce((best, node) => {
      const room = node.scrollHeight - node.clientHeight;
      return room > (best.scrollHeight - best.clientHeight) ? node : best;
    }, document.scrollingElement || document.documentElement);
  }

  function isBefore(node, target) {
    return Boolean(node.compareDocumentPosition(target) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  function stableId(url, index) {
    let hash = 0;
    for (const char of url) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `gptimg-${index}-${hash.toString(36)}`;
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("FileReader failed."));
      reader.readAsDataURL(blob);
    });
  }
})();
