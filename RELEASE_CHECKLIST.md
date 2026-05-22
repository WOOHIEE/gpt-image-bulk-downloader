# Release Checklist

Run these checks before publishing or handing off a build.

## Build

```powershell
npm run icons
npm run audit
npm run cancel-smoke
npm run verify
npm run build
npm run package
```

## Manual QA

- Load `dist` as an unpacked extension.
- Open `https://chatgpt.com/images/`.
- When a CDP test browser is available, run `npm run live-smoke`.
- Run current loaded scan and confirm it only selects the currently loaded gallery images.
- Run full image scan and confirm it reaches the expected full library count.
- Confirm prompt previews match the image cards.
- Download 2-3 images with metadata enabled.
- Start a multi-image job and press Stop; confirm the active job ends, failures stay at zero, and the remaining queue is marked skipped.
- Verify downloaded PNG files contain `Prompt`, `GPT Image Metadata`, and `XML:com.adobe.xmp` chunks.
- Run a small retry test by blocking network or using an invalid image URL in a controlled test.
- Confirm CSV manifest records status, attempts, download ID, actual path, and error fields.

## Store Listing

- Add screenshots from `artifacts/` or fresh Chrome Web Store screenshots.
- Link `PRIVACY.md` from the listing/support site.
- Use the permission rationale from `STORE_LISTING.md`.
- Confirm the item has one clear purpose: bulk-download ChatGPT images with prompt metadata.
- Confirm no external data collection or transmission claim conflicts with the implementation.
