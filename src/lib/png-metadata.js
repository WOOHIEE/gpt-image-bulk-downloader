const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const crcTable = createCrcTable();

export function isPng(arrayBuffer) {
  const bytes = arrayBuffer instanceof Uint8Array
    ? arrayBuffer
    : new Uint8Array(arrayBuffer);
  return PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

export function embedPngMetadata(arrayBuffer, metadata) {
  const bytes = arrayBuffer instanceof Uint8Array
    ? arrayBuffer
    : new Uint8Array(arrayBuffer);
  if (!isPng(bytes)) {
    throw new Error("Input is not a PNG datastream.");
  }

  const iend = findChunk(bytes, "IEND");
  if (!iend) throw new Error("PNG IEND chunk was not found.");

  const chunks = [
    createTextChunk("Software", "GPT Image Bulk Downloader"),
    createTextChunk("Description", latin1Preview(metadata.prompt || "")),
    createTextChunk("Comment", latin1Preview(metadata.prompt || "")),
    createITXtChunk("Prompt", metadata.prompt || ""),
    createITXtChunk("ChatGPT Prompt", metadata.prompt || ""),
    createITXtChunk("Source URL", metadata.sourceUrl || ""),
    createITXtChunk("Conversation", metadata.conversationTitle || ""),
    createITXtChunk("GPT Image Metadata", JSON.stringify(metadata, null, 2)),
    createITXtChunk("XML:com.adobe.xmp", buildXmp(metadata))
  ];

  return concatBytes([
    bytes.subarray(0, iend.offset),
    ...chunks,
    bytes.subarray(iend.offset)
  ]);
}

export function listPngChunks(arrayBuffer) {
  const bytes = arrayBuffer instanceof Uint8Array
    ? arrayBuffer
    : new Uint8Array(arrayBuffer);
  const chunks = [];
  assertSignature(bytes);

  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, length, offset });
    offset += 12 + length;
    if (type === "IEND") break;
  }
  return chunks;
}

export function extractTextChunks(arrayBuffer) {
  const bytes = arrayBuffer instanceof Uint8Array
    ? arrayBuffer
    : new Uint8Array(arrayBuffer);
  const values = [];

  for (const chunk of listPngChunks(bytes)) {
    const dataStart = chunk.offset + 8;
    const data = bytes.subarray(dataStart, dataStart + chunk.length);
    if (chunk.type === "tEXt") values.push(parseTextChunk(data));
    if (chunk.type === "iTXt") values.push(parseInternationalTextChunk(data));
  }
  return values.filter(Boolean);
}

function findChunk(bytes, typeName) {
  return listPngChunks(bytes).find((chunk) => chunk.type === typeName);
}

function createTextChunk(keyword, text) {
  const keywordBytes = latin1Bytes(keyword.slice(0, 79));
  const textBytes = latin1Bytes(text);
  return createChunk("tEXt", concatBytes([
    keywordBytes,
    new Uint8Array([0]),
    textBytes
  ]));
}

function createITXtChunk(keyword, text) {
  const keywordBytes = latin1Bytes(keyword.slice(0, 79));
  const textBytes = encoder.encode(String(text || ""));
  return createChunk("iTXt", concatBytes([
    keywordBytes,
    new Uint8Array([0, 0, 0, 0, 0]),
    textBytes
  ]));
}

function createChunk(typeName, data) {
  const type = latin1Bytes(typeName);
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, data.length);
  const crc = new Uint8Array(4);
  new DataView(crc.buffer).setUint32(0, crc32(concatBytes([type, data])));
  return concatBytes([length, type, data, crc]);
}

function parseTextChunk(data) {
  const separator = data.indexOf(0);
  if (separator < 1) return null;
  return {
    type: "tEXt",
    keyword: ascii(data.subarray(0, separator)),
    text: ascii(data.subarray(separator + 1))
  };
}

function parseInternationalTextChunk(data) {
  const firstNull = data.indexOf(0);
  if (firstNull < 1 || data.length < firstNull + 5) return null;
  let cursor = firstNull + 3;
  const languageEnd = data.indexOf(0, cursor);
  if (languageEnd < 0) return null;
  cursor = languageEnd + 1;
  const translatedEnd = data.indexOf(0, cursor);
  if (translatedEnd < 0) return null;
  cursor = translatedEnd + 1;
  return {
    type: "iTXt",
    keyword: ascii(data.subarray(0, firstNull)),
    text: decoder.decode(data.subarray(cursor))
  };
}

function buildXmp(metadata) {
  const prompt = xmlEscape(metadata.prompt || "");
  const sourceUrl = xmlEscape(metadata.sourceUrl || "");
  const pageUrl = xmlEscape(metadata.pageUrl || "");
  const createdAt = xmlEscape(metadata.createdAt || new Date().toISOString());
  return [
    '<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    '<rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"',
    ' xmlns:xmp="http://ns.adobe.com/xap/1.0/"',
    ' xmlns:gptimg="https://local.gpt-image-dl/metadata/1.0/">',
    `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${prompt}</rdf:li></rdf:Alt></dc:description>`,
    `<xmp:CreatorTool>GPT Image Bulk Downloader</xmp:CreatorTool>`,
    `<xmp:CreateDate>${createdAt}</xmp:CreateDate>`,
    `<gptimg:Prompt>${prompt}</gptimg:Prompt>`,
    `<gptimg:SourceURL>${sourceUrl}</gptimg:SourceURL>`,
    `<gptimg:PageURL>${pageUrl}</gptimg:PageURL>`,
    '</rdf:Description></rdf:RDF></x:xmpmeta>',
    '<?xpacket end="w"?>'
  ].join("");
}

function latin1Preview(value) {
  return String(value || "")
    .replace(/[^\u0009\u000a\u000d\u0020-\u00ff]/gu, "?")
    .slice(0, 8000);
}

function latin1Bytes(value) {
  return Uint8Array.from(String(value), (char) => char.charCodeAt(0) & 0xff);
}

function ascii(bytes) {
  return String.fromCharCode(...bytes);
}

function concatBytes(parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function assertSignature(bytes) {
  if (!isPng(bytes)) throw new Error("Invalid PNG signature.");
}

function readUint32(bytes, offset) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}
