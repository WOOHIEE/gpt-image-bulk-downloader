# Contributing

Thanks for helping improve GPT Image Bulk Downloader.

## Local setup

```powershell
npm run verify
npm run build
```

Load `dist/` from `chrome://extensions` with Developer mode enabled.

## Development rules

- Keep the extension local-only. Do not add analytics, tracking, remote scripts, or developer-owned servers.
- Keep Manifest V3 permissions narrow and purpose-bound.
- Do not broaden host permissions unless a ChatGPT/OpenAI image URL change requires it.
- Keep scan modes separate:
  - current loaded scan should only use images currently loaded in the ChatGPT Images page
  - full image scan should use ChatGPT Images pagination
- Preserve prompt metadata output in PNG `iTXt`, `tEXt`, XMP, CSV manifest, and optional JSON sidecar paths.
- Keep download cancellation abortable through the current image fetch and Chrome download wait path.

## Verification

Run these checks before opening a pull request:

```powershell
npm run audit
npm run cancel-smoke
npm run verify
npm run build
npm run package
```

If you have a logged-in ChatGPT browser on the configured CDP port, also run:

```powershell
$env:GPTIMG_CDP_PORT = "9241"
npm run live-smoke
```

The live smoke checks gallery scanning, prompt recovery before download, PNG metadata output, CSV/JSON outputs, and cancellation.
