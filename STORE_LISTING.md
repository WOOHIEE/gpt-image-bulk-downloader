# Chrome Web Store Listing Draft

## Name

GPT Image Bulk Downloader

## Short description

Bulk download ChatGPT images and keep the original prompt inside PNG metadata.

## Detailed description

GPT Image Bulk Downloader helps creators, prompt engineers, designers, and AI image users manage large ChatGPT image batches.

Open a ChatGPT image-generation conversation or the ChatGPT Images library, scan the page, review the detected images and prompts, then download selected images in sequence. The extension converts downloads to PNG when needed and embeds the prompt into PNG text and XMP metadata so the file remains traceable later.

Features:

- Scan the current loaded ChatGPT Images view or the full image library
- Scan current ChatGPT conversations and long image-generation threads
- Select hundreds or thousands of images for sequential download
- Auto-pair generated images with the previous user prompt
- Edit prompt text before saving
- Embed prompt into PNG `iTXt`, `tEXt`, and XMP metadata
- Export CSV manifest and optional JSON sidecars
- Configure folder, filename template, and download delay
- Stop an active download job and skip the remaining queue cleanly
- Local-only processing with no external server

## Permission rationale

- `downloads`: saves selected images and CSV/JSON metadata files.
- `storage`: stores user settings locally.
- `scripting`: injects the scanner into the active ChatGPT tab if Chrome did not load it yet.
- `activeTab`: limits active-tab operations to the user-triggered tab.
- ChatGPT/OpenAI host permissions: fetches displayed image files and reads image/prompt content from ChatGPT pages.
