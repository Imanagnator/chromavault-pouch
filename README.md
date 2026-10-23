# chromavault-pouch

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![CI Pipeline](https://github.com/Imanagnator/chromavault-pouch/actions/workflows/ci.yml/badge.svg)](https://github.com/Imanagnator/chromavault-pouch/actions/workflows/ci.yml)

**Author:** Tamal Mitra ([@Imanagnator](https://github.com/Imanagnator))  
**Version:** 0.1.0  
**License:** [MIT](LICENSE)

> **Turn any collection of files into a standalone, portable, encrypted HTML pouch.**

---

### What's in a Name? (Terminology Guide)
- **Main App: chromavault-pouch**: The web application used to bundle and encrypt staged files into a single offline container.
- **Created Artifact: pouch (`.html`)**: The self-extracting, zero-dependency HTML file created by the app. It opens anywhere directly in any browser (even offline or air-gapped) with built-in media, document, and code viewers.
- **Protocol: HDA CCA**: *Hierarchical Data Archive / Cellular Compute Architecture* — the high-performance binary packing and chunked streaming protocol running behind the scenes.

---

## 1. High-Level System Architecture

```text
+-------------------------------------------------------------------------------+
|                             ChromaVault Web App                               |
|   (Vite + React 19 + TailwindCSS + Motion + Web Crypto + Deflate Compression) |
+---------------------------------------+---------------------------------------+
                                        |
                            1. Select & Validate Files
                            2. Derive Master Key (PBKDF2 600k iterations)
                            3. Compress (Deflate Stream) & Encrypt (AES-256-GCM)
                            4. Package Self-Extracting Executable HTML
                                        |
                                        v
+-------------------------------------------------------------------------------+
|                       STANDALONE .HTML POUCH FILE                             |
|                                                                               |
|  [0..N bytes]        HTML/JS Viewer Core + Offline CSS + UI Scripts           |
|  [N..N+64KB]         Padding (Zero/Space byte safety delimiter)               |
|  [Payload Blocks]    Binary cells [16B salt + 12B IV + Deflated/AES-GCM data] |
|  [Spine JSON]        Catalog metadata (files, sizes, offsets, SHA-256 hash)   |
|  [Footer: 24 Bytes]  [HeaderLen (8B)] [SpineLen (4B)] ['CCAP' (4B)] [Ver (4B)]|
+-------------------------------------------------------------------------------+
                                        |
                 +----------------------+----------------------+
                 |                                             |
                 v                                             v
        [Local File Tethering]                      [Remote HTTP 206 Streaming]
   Direct Blob.slice() in RAM                 Range: bytes=X-Y without full DL
                 |                                             |
                 +----------------------+----------------------+
                                        |
                                        v
                        +-------------------------------+
                        |   LRU Blob Cache (150MB Cap)  |
                        +---------------+---------------+
                                        |
               +------------------------+------------------------+
               |                        |                        |
               v                        v                        v
        Image / Video           Continuous Audio           Lazy PDF Viewer
     (Pan, Zoom, Rotate)      (Independent Player)     (IntersectionObserver)
```

---

## 2. Technical Decisions & Production Rationale

1. **Embedded Double-Click Mode (Eliminates Re-Select Prompt)**:
   - *Decision*: Automatically embed compressed payloads <= 300MB as chunked Base64 inside hidden `<script type="application/octet-stream" data-pouch-chunk="N">` tags.
   - *Rationale*: Browsers restrict `file://` origins from making `fetch()` or `XMLHttpRequest` calls even to their own file path, which historically forced users to re-select the HTML file upon double-clicking. With embedded chunk parsing directly from the DOM, the pouch opens instantly on double-click with zero permission modals or re-selection prompts. Pouches > 300MB automatically fall back to append mode for high-efficiency HTTP range streaming.

2. **Master Salt & Key Derivation**:
   - *Decision*: Derive a single master PBKDF2 key (600,000 iterations) per pouch session, pairing with random 96-bit IVs per file block.
   - *Rationale*: Running PBKDF2 600,000 times for each file (e.g. 50 files = 30M iterations) blocked the browser for 30+ seconds. Reusing the master key with cryptographically unique random IVs adheres to NIST SP 800-38D recommendations while cutting packing time from 30s to < 1s.

3. **Zero-RAM Remote Streaming with Range Requests**:
   - *Decision*: Check for `HEAD` Content-Length, supplemented by an active `bytes=0-0` Range probe.
   - *Rationale*: CDNs frequently omit `Accept-Ranges` in `HEAD` responses. An active 0-byte range probe reliably identifies byte-range support, preventing unintentional multi-gigabyte blob downloads.

4. **Multi-Stage LRU Blob Recycling**:
   - *Decision*: A dedicated `LRUBlobCache` maintains loaded blobs up to 150MB, evicting oldest unreferenced objects in strict LRU order.
   - *Rationale*: Prevents mobile browser tabs from crashing with OOM exceptions during prolonged viewing sessions.

5. **Iframe Sandboxing**:
   - *Decision*: Any embedded HTML or interactive application is executed within `<iframe sandbox="allow-scripts allow-downloads allow-forms">`.
   - *Rationale*: Drops `allow-same-origin`, preventing untrusted embedded HTML payloads from accessing the host pouch's secrets, password hashes, or localStorage.

---

## 3. Security Model

- **Encryption**: AES-256-GCM authenticated encryption with 128-bit authentication tags.
- **Key Derivation**: PBKDF2 with HMAC-SHA-256 and 600,000 iterations.
- **XSS Prevention**: Strict HTML escaping (`escapeHtml`) on all user-supplied filenames, folder categories, and titles prior to DOM insertion.
- **Memory Safety**: Distinct Object URL lifecycles for active document viewer vs background audio player to prevent audio playback interruption or dangling pointers.

---

## 4. Setup, Run, and Test

### Prerequisites
- Node.js >= 20.x
- npm >= 10.x

### Installation
```bash
# Clone and install dependencies
git clone https://github.com/Imanagnator/chromavault-pouch.git
cd chromavault-pouch
npm ci
```

### Development Server
```bash
npm run dev
# Server boots at http://localhost:3000
```

### Typecheck & Linting
```bash
npm run lint
```

### Automated Unit & Integration Tests
```bash
npm run test
```

### Production Build
```bash
npm run build
```

---

## 5. Docker Deployment

### Run with Docker Compose
```bash
docker compose up -d --build
```
Access the application at `http://localhost:3000`.
Byte-range headers (`Accept-Ranges bytes`) and security headers are automatically pre-configured in the container's Nginx configuration.

---

## Built-in viewers

Every pouch embeds a fully offline viewer runtime (`services/viewer/*`, ~150 KB, no external requests). Each module is plain browser JS imported with `?raw` and inlined into the generated HTML, so you can edit a viewer without touching the generator.

| Type | Highlights |
|---|---|
| **Music** (mp3, m4a, flac, wav, ogg, opus…) | ID3v1/v2, FLAC and MP4 tags with **cover art**, queue with shuffle / repeat, 5-band **EQ** + presets, live **visualizer**, synced lyrics from a same-named `.lrc`, sleep timer, speed 0.5–2×, Media Session (lock-screen controls), **mini-player keeps playing while you browse other files** |
| **Video** (mp4, webm, mov, mkv…) | Custom controls, **double-tap ±10 s**, swipe for volume / brightness, hold for 2×, SRT/VTT subtitles (auto-matched by file name, size / delay / background), resume position, playlist + auto-next, PiP, frame capture, 0.25–3× speed |
| **Images** (png, jpg, gif, webp, svg, avif…) | Wheel / **pinch** zoom, drag pan, double-tap zoom, swipe to navigate, rotate / flip, thumbnail strip, slideshow, EXIF details, transparency grid, copy to clipboard |
| **PDF** | Continuous lazy-rendered pages, selectable text, **search with highlights**, thumbnails, outline, working links, pinch zoom, night mode, remembers last page, password prompt, "Compatibility mode" fallback |
| **Text & code** (60+ formats) | Syntax highlighting, line numbers, regex search, go-to-line, encodings (UTF-8/16, Windows-1252, Shift-JIS, GBK…), themes (dark / light / sepia), font size, word wrap |
| **Markdown** | GFM tables, task lists, footnotes, callouts, outline sidebar, progress bar, front matter, copy-code buttons, local images resolved from the pouch, **XSS-safe** (remote images blocked until tapped) |
| **Data** | JSON collapsible tree with path copy · CSV/TSV sortable & filterable table (auto delimiter) · Jupyter notebooks · HTML sandboxed preview / source |

Keyboard: `Space`/`K` play · `←/→` seek or navigate · `↑/↓` volume · `F` fullscreen · `M` mute · `S` shuffle / slideshow · `R` repeat / rotate · `I` info · `Ctrl+F` or `/` search · `Ctrl+G` go to line / page · `+`/`-` zoom.

Notes
- Files that can be viewed (media, PDF, images, text) are always opened in memory; only unknown binary types over 50 MB use the stream-to-disk prompt.
- Unknown extensions are sniffed: if the first 8 KB look like text, they open in the text viewer.
- Tests for the runtime live in `tests/viewerRuntime.test.ts`.

### Offline note
When a pouch is generated, the app downloads the PDF engine (pdf.js) and Tailwind runtime from public CDNs and inlines them. If that download fails (e.g. you are offline while packing), the pouch is built with CDN links instead and the app warns you; PDF viewing then needs internet on first open.

---

## 6. Community & Contributing

- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md) for pull request guidelines and test expectations.
- **Code of Conduct**: See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
- **Security Policy**: See [SECURITY.md](SECURITY.md) for reporting suspected vulnerabilities responsibly.
- **Citation**: For academic or technical citation, see [CITATION.cff](CITATION.cff).
- **Third-party notices**: See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **License**: Released under the [MIT License](LICENSE). Copyright (c) 2026 Tamal Mitra.
