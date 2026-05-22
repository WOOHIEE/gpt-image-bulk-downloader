# Security

GPT Image Bulk Downloader is designed as a local-only Chrome extension.

## Security posture

- No remote code is loaded.
- No analytics, trackers, or third-party scripts are included.
- The extension uses Manifest V3 and a self-only extension page CSP.
- Data processing happens in the browser before Chrome saves files.
- Host permissions are limited to ChatGPT pages and known OpenAI image asset hosts.

## Reporting

Report security issues to the publisher account used for the Chrome Web Store listing. Do not include private prompts or downloaded images in public reports.

## Sensitive data handling

The extension reads prompts and image URLs only after the user clicks scan/download controls. Prompt text may be embedded into downloaded PNG metadata, CSV manifests, or optional JSON sidecars because that is the user-facing purpose of the extension.
