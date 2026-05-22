# Changelog

## 0.2.0

- Added abortable in-progress download cancellation.
- Split ChatGPT Images scanning into current loaded images and full gallery pagination.
- Moved prompt recovery into the background download pipeline so large selections start immediately.
- Excluded ChatGPT default template cards from gallery results.
- Added live smoke coverage for full gallery scans, prompt metadata resolution, actual download output, and cancellation.
- Added open-source packaging files and release-readiness documentation.

## 0.1.0

- Initial Manifest V3 extension.
- Bulk image scanning, sequential downloads, PNG prompt metadata, CSV manifest export, and optional JSON sidecars.
