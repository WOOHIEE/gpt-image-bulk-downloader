# GPT Image Bulk Downloader

> Bulk download ChatGPT images and preserve the prompt inside PNG metadata.

[한국어 README](./README.ko.md)

Current extension version: `0.2.1`

GPT Image Bulk Downloader is a local-only Manifest V3 Chrome extension for ChatGPT image-heavy workflows. It helps you scan hundreds or thousands of generated images, download them in a controlled queue, and keep each file traceable by embedding the prompt into PNG metadata.

## Why

ChatGPT image libraries can grow quickly. Saving images one by one is slow, and once files are downloaded it is easy to lose track of which prompt created which image. This extension solves that by pairing images with prompts, exporting a CSV manifest, and writing prompt metadata into the downloaded PNG files.

## Features

- Scan images from normal ChatGPT conversations.
- Scan `chatgpt.com/images/` in two modes:
  - **Current Loaded Scan**: only images currently loaded in the page.
  - **Full Image Scan**: paginates the ChatGPT Images backend and collects the full image library.
- Exclude ChatGPT default template cards from results.
- Select hundreds or thousands of images for sequential download.
- Resolve the best available prompt per image in the background before saving.
- Embed prompt metadata into PNG `iTXt`, `tEXt`, and XMP fields.
- Export a CSV manifest and optional JSON sidecars.
- Configure folder name, filename template, delay, retry count, and metadata behavior.
- Stop an active job. The current fetch/download is aborted and the remaining queue is marked as skipped.
- Local-only processing. No analytics, trackers, remote code, or developer-owned server.

## Quick Install From GitHub ZIP

No Node.js build is required for normal use. The repository root is already a valid unpacked Chrome extension.

1. Open the GitHub repository page.
2. Click **Code** -> **Download ZIP**.
3. Extract the ZIP file.
4. Open `chrome://extensions`.
5. Enable **Developer mode**.
6. Click **Load unpacked**.
7. Select the folder that directly contains `manifest.json`.

Important: Windows may create a nested folder when extracting GitHub ZIP files. If you extracted to the default destination, the correct folder may be:

```text
Downloads\gpt-image-bulk-downloader-main\gpt-image-bulk-downloader-main
```

not:

```text
Downloads\gpt-image-bulk-downloader-main
```

The folder you choose in Chrome must show these files directly inside it:

```text
manifest.json
popup.html
options.html
src
assets
```

## Troubleshooting: Manifest File Is Missing

If Chrome shows **"Manifest file is missing or unreadable"**, you selected the wrong folder.

Fix:

1. Click **Cancel**.
2. Open the extracted ZIP folder in File Explorer.
3. Go one level deeper until you can see `manifest.json`.
4. In Chrome, click **Load unpacked** again and select that exact folder.

## Developer Build

Requirements:

- Chrome 116 or newer
- Node.js 20 or newer

Build the `dist` bundle:

```powershell
npm run verify
npm run build
```

Then load the `dist` folder from `chrome://extensions`.

## Usage

1. Open a ChatGPT conversation or `https://chatgpt.com/images/`.
2. Open the extension popup.
3. Click **Current Loaded Scan** if you only want images currently loaded in the page.
4. Click **Full Image Scan** if you want the whole ChatGPT Images library.
5. Select the images to download.
6. Configure output folder, delay, retry count, and metadata options.
7. Click the download button.
8. Click **Stop** while a job is running to abort the current operation and skip the remaining queue.

Default output folder:

```text
GPT Images/{date}
```

## Filename Templates

Supported tokens:

- `{date}`: `YYYY-MM-DD`
- `{time}`: `HHMMSS`
- `{index}`: zero-padded sequence number
- `{prompt}`: prompt preview
- `{conversation}`: conversation title
- `{imageId}`: detected image ID

## Metadata

When metadata embedding is enabled, the extension converts the output to PNG when needed and writes prompt data to:

- `iTXt` `Prompt`
- `iTXt` `ChatGPT Prompt`
- `iTXt` `GPT Image Metadata`
- `iTXt` `XML:com.adobe.xmp`
- `tEXt` `Description`
- `tEXt` `Comment`

Windows Explorer may not display every PNG metadata field in the details panel, depending on Windows and codec behavior. The prompt is still stored in the PNG chunks, and CSV/JSON outputs provide an additional audit trail.

## Development

```powershell
npm run audit
npm run cancel-smoke
npm run verify
npm run build
npm run package
```

For live verification against a logged-in ChatGPT browser launched with Chrome DevTools Protocol:

```powershell
$env:GPTIMG_CDP_PORT = "9241"
npm run live-smoke
```

If your Chrome build does not expose the CDP Extensions domain, load `dist/` manually from `chrome://extensions`, copy the extension ID, then run:

```powershell
$env:GPTIMG_CDP_PORT = "9241"
$env:GPTIMG_EXTENSION_ID = "your_extension_id"
npm run live-smoke
```

The live smoke test checks gallery scanning, template exclusion, prompt recovery, PNG metadata output, CSV/JSON output, real downloads, and stop/cancel behavior.

## Release

Create a release ZIP:

```powershell
npm run package
```

Output:

```text
release/gpt-image-bulk-downloader.zip
```

Before publishing, review:

- `RELEASE_CHECKLIST.md`
- `STORE_LISTING.md`
- `PRIVACY.md`
- `SECURITY.md`

## Privacy

The extension does not collect, sell, transmit, or store user data on any external server. It reads ChatGPT pages only when the user scans or downloads images, and uses Chrome storage only for local settings.

## License

MIT
