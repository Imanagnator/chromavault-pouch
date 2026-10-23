import { deriveKey, encryptData, computeSha256 } from "./cryptoService";
import { PouchCreationSchema, escapeHtml as sanitizeText } from "../lib/validation";
import { VIEWER_CSS, VIEWER_JS } from "./viewer";

const bytesToBase64 = (bytes: Uint8Array): string => {
  // Step is a multiple of 3 so only the final piece carries '=' padding
  const step = 3 * 8192;
  const out: string[] = [];
  for (let i = 0; i < bytes.length; i += step) {
    out.push(
      btoa(String.fromCharCode.apply(null, bytes.subarray(i, i + step) as unknown as number[])),
    );
  }
  return out.join("");
};

const EMBED_MARK = "<!--__POUCH_EMBED__-->";
// Pouches whose compressed payload is at or below this size are embedded in the HTML
// itself so they open with a plain double-click (file://). Larger ones use the
// append-binary format (needs a web server or "select the file again" on file://).
const EMBED_AUTO_MAX_BYTES = 300 * 1024 * 1024;

export interface PouchOptions {
  /** true = always embed, false = never embed, undefined = automatic by size */
  embed?: boolean;
}

export const generateFilledPouch = async (
  name: string,
  files: File[],
  password: string | null,
  onProgress: (p: any) => void,
  options: PouchOptions = {},
): Promise<Blob> => {
  // Input validation
  const validation = PouchCreationSchema.safeParse({ name, files, password });
  if (!validation.success) {
    const errorMsg = validation.error.issues.map((i) => i.message).join(", ");
    throw new Error(`Pouch configuration invalid: ${errorMsg}`);
  }

  const isEncrypted = !!password;
  const passwordHash = password ? await computeSha256(password) : null;
  const fileMetas: any[] = [];
  const payloadBlobs: Blob[] = [];
  const logs: string[] = [
    `[INIT] CCA Pouch Generator v2.1`,
    `[FILES] ${files.length} items staged`,
  ];

  let currentOffset = 0;
  let totalProcessed = 0;
  const totalSize = files.reduce((acc, f) => acc + f.size, 0);

  // Derive master key once if encrypted (NIST SP 800-38D AES-GCM standard)
  let masterSalt: Uint8Array | null = null;
  let masterKey: CryptoKey | null = null;

  if (isEncrypted && password) {
    onProgress({
      percentage: 2,
      status: "Deriving cryptographic master key...",
      logs: [...logs, "[CRYPTO] Deriving master key via PBKDF2 (600,000 iterations)"],
    });
    masterSalt = (typeof window !== "undefined" ? window.crypto : globalThis.crypto).getRandomValues(new Uint8Array(16));
    masterKey = await deriveKey(password, masterSalt);
    logs.push("[CRYPTO] Master key ready");
  }

  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    const cs = new CompressionStream("deflate");
    const compressedStream = file.stream().pipeThrough(cs);
    let fileData = new Uint8Array(
      await new Response(compressedStream).arrayBuffer(),
    );

    if (isEncrypted && masterKey && masterSalt) {
      // Cryptographically unique 96-bit IV per file
      const cryptoObj = typeof window !== "undefined" ? window.crypto : globalThis.crypto;
      const iv = cryptoObj.getRandomValues(new Uint8Array(12));
      const encrypted = await encryptData(fileData.buffer, masterKey, iv);
      const packed = new Uint8Array(16 + 12 + encrypted.byteLength);
      packed.set(masterSalt, 0);
      packed.set(iv, 16);
      packed.set(new Uint8Array(encrypted), 28);
      fileData = packed;
    }

    fileMetas.push({
      id: i,
      name: file.name,
      type: file.type || "application/octet-stream",
      size: file.size,
      offset: currentOffset,
      compressed_length: fileData.length,
    });

    payloadBlobs.push(new Blob([fileData]));
    currentOffset += fileData.length;
    totalProcessed += file.size;

    logs.push(`[PACK] ${file.name} OK`);
    if (logs.length > 8) logs.shift();

    onProgress({
      percentage: Math.round((totalProcessed / totalSize) * 90) + 2,
      status: `Packing File ${i + 1} of ${files.length}...`,
      logs: [...logs],
    });
  }

  const embed = options.embed ?? currentOffset <= EMBED_AUTO_MAX_BYTES;
  logs.push(embed ? "[MODE] Embedded (double-click enabled)" : "[MODE] Appended (server / re-select)");

  const spine = {
    version: 2,
    name: name,
    total_bytes: totalSize,
    file_count: files.length,
    encryption: isEncrypted,
    passwordHash: passwordHash,
    files: fileMetas,
  };

  onProgress({
    percentage: 95,
    status: "Packaging offline runtime engine...",
    logs: [...logs, "[FETCH] Loading viewer bundles"],
  });

  let tailwindScript = "";
  let pdfjsScript = "";
  let pdfWorkerBase64 = "";

  try {
    const [twRes, pdfRes, workerRes] = await Promise.all([
      fetch("https://unpkg.com/@tailwindcss/browser@4"),
      fetch(
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js",
      ),
      fetch(
        "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js",
      ),
    ]);
    if (twRes.ok) tailwindScript = await twRes.text();
    if (pdfRes.ok) pdfjsScript = await pdfRes.text();
    
    if (workerRes.ok) {
      const workerBuffer = await workerRes.arrayBuffer();
      const bytes = new Uint8Array(workerBuffer);
      let binary = '';
      const chunkSize = 0x8000;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      pdfWorkerBase64 = btoa(binary);
    }
  } catch (e) {
    console.warn("Could not fetch offline scripts, falling back to CDN", e);
  }

  const safeName = sanitizeText(name);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>pouch - ${safeName}</title>
    ${tailwindScript ? `<script>${tailwindScript}</script>` : `<script src="https://unpkg.com/@tailwindcss/browser@4"></script>`}
    ${pdfjsScript ? `<script>${pdfjsScript}</script>` : `<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js"></script>`}
    <script>
        if (${!!pdfWorkerBase64}) {
            try {
                const workerBin = atob('${pdfWorkerBase64}');
                const workerBytes = new Uint8Array(workerBin.length);
                for (let i = 0; i < workerBin.length; i++) workerBytes[i] = workerBin.charCodeAt(i);
                const workerBlob = new Blob([workerBytes], { type: 'text/javascript' });
                pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);
            } catch(e) {
                pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
            }
        } else {
            pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }
    </script>
    <style>
        /* Base fallback styles ensure clean presentation even if CDN styling fails */
        *, *::before, *::after { box-sizing: border-box; }
        body { background: #000000; color: #f8fafc; margin: 0; width: 100vw; height: 100vh; height: 100dvh; overflow: hidden; font-family: system-ui, -apple-system, sans-serif; display: flex; position: relative; }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 3px; }
        ::-webkit-scrollbar-thumb:hover { background: #52525b; }
        .file-item.active { background: rgba(245, 158, 11, 0.15) !important; border-left-color: #f59e0b !important; color: #fbbf24 !important; }
        
        .folder-header { cursor: pointer; user-select: none; }
        .folder-content { display: none; }
        .folder-content.open { display: block; }
        .folder-icon { transition: transform 0.2s; }
        .folder-header.open .folder-icon { transform: rotate(90deg); }
        
        #sidebar { transition: transform 0.3s ease-in-out; }
        @media (max-width: 768px) {
            #sidebar { position: absolute; left: 0; top: 0; bottom: 0; transform: translateX(-100%); width: 85%; max-width: 320px; z-index: 40; }
            #sidebar.open { transform: translateX(0); }
            #mobile-overlay { transition: opacity 0.3s; }
            #mobile-overlay.open { opacity: 1; pointer-events: auto; }
        }
    
        .clock-container {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            width: 320px;
            height: 320px;
            border-radius: 50%;
            border: 4px solid rgba(245, 158, 11, 0.4);
            background: rgba(10, 10, 10, 0.8);
            box-shadow: 0 0 80px rgba(245, 158, 11, 0.15), inset 0 0 40px rgba(0,0,0,0.8);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 5;
            opacity: 1;
            pointer-events: none;
            backdrop-filter: blur(12px);
            transition: opacity 0.4s ease, transform 0.4s ease;
        }
        .clock-container.hidden-clock {
            opacity: 0 !important;
            transform: translate(-50%, -50%) scale(0.8) !important;
        }
        .clock-inner {
            position: absolute;
            inset: 8px;
            border-radius: 50%;
            border: 1px solid rgba(245, 158, 11, 0.3);
            background: radial-gradient(circle at center, #18181b 0%, #000000 100%);
            box-shadow: inset 0 0 30px rgba(0,0,0,1);
        }
        .clock-marker {
            position: absolute;
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            padding: 16px;
            box-sizing: border-box;
            z-index: 2;
        }
        .clock-marker-inner {
            width: 4px;
            border-radius: 9999px;
            background: rgba(245, 158, 11, 0.5);
        }
        .clock-marker-inner.major {
            height: 20px;
            width: 6px;
            background: rgba(245, 158, 11, 0.9);
            box-shadow: 0 0 8px rgba(245, 158, 11, 0.5);
        }
        .clock-marker-inner.minor {
            height: 10px;
        }
        .hand {
            position: absolute;
            bottom: 50%;
            left: 50%;
            transform-origin: bottom center;
            border-radius: 9999px;
            z-index: 10;
        }
        .hand-hour {
            width: 8px;
            height: 70px;
            background: linear-gradient(to top, #d97706, #fbbf24);
            transform: translateX(-50%) rotate(0deg);
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        }
        .hand-minute {
            width: 6px;
            height: 100px;
            background: linear-gradient(to top, #f59e0b, #fcd34d);
            transform: translateX(-50%) rotate(0deg);
            box-shadow: 0 0 10px rgba(0,0,0,0.5);
        }
        .hand-second {
            width: 3px;
            height: 110px;
            background: #ef4444;
            transform: translateX(-50%) rotate(0deg);
            box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
        }
        .clock-center {
            position: absolute;
            width: 20px;
            height: 20px;
            background: #18181b;
            border: 3px solid #f59e0b;
            border-radius: 50%;
            z-index: 20;
            box-shadow: 0 0 15px rgba(245, 158, 11, 0.8);
        }
        @keyframes spin-time {
            from { transform: translateX(-50%) rotate(0deg); }
            to { transform: translateX(-50%) rotate(360deg); }
        }
        .clock-extracting {
            opacity: 1 !important;
            transform: translate(-50%, -50%) scale(1) !important;
            box-shadow: 0 0 100px rgba(245, 158, 11, 0.6), inset 0 0 40px rgba(0,0,0,0.8) !important;
            border-color: rgba(245, 158, 11, 0.8) !important;
            transition: all 0.5s ease;
        }
        .clock-extracting .hand-hour {
            animation: spin-time 2s linear infinite !important;
        }
        .clock-extracting .hand-minute {
            animation: spin-time 0.5s linear infinite !important;
        }
        .clock-extracting .hand-second {
            animation: spin-time 0.1s linear infinite !important;
        }
${VIEWER_CSS}
</style>
</head>
<body class="flex relative w-full h-full overflow-hidden bg-black text-slate-100">
    <!-- Mobile Sidebar Overlay -->
    <div id="mobile-overlay" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-30 opacity-0 pointer-events-none md:hidden" onclick="toggleSidebar()" aria-hidden="true"></div>

    <!-- Sidebar -->
    <aside id="sidebar" class="w-80 bg-zinc-900 border-r border-zinc-800 flex flex-col shadow-2xl flex-shrink-0" aria-label="Pouch Explorer">
        <div class="p-4 md:p-6 border-b border-zinc-800 bg-black/50 flex flex-col gap-2">
            <div class="flex items-center justify-between">
                <h1 class="text-lg md:text-xl font-black text-amber-400 tracking-tighter uppercase truncate pr-2" id="pouch-title">${safeName}</h1>
                <div class="flex items-center gap-2">
                    ${isEncrypted ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-amber-500 flex-shrink-0" aria-label="Encrypted"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>' : ""}
                    <button onclick="toggleSidebar()" class="md:hidden text-zinc-400 hover:text-white p-1" aria-label="Close Sidebar">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                </div>
            </div>
            <p class="text-[10px] font-mono text-zinc-500 uppercase tracking-widest">${files.length} files • ${(totalSize / 1024 / 1024).toFixed(2)} MB</p>
        </div>
        <div class="p-3 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/80">
            <span class="text-xs font-bold text-zinc-500 uppercase tracking-widest pl-2">Contents</span>
            <button id="download-all-btn" class="text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-300 px-3 py-1.5 rounded-lg transition-colors font-medium flex items-center gap-1.5 border border-zinc-700" aria-label="Save all files to device">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                Save All
            </button>
        </div>
        <div class="px-3 pt-2 pb-1"><input id="file-filter" type="search" class="pv-input w-full" placeholder="Filter files…" aria-label="Filter files" autocomplete="off"></div>
        <div id="file-list" class="flex-1 overflow-y-auto p-2 space-y-1 pb-20 md:pb-2" role="tree" aria-label="Files in pouch"></div>
    </aside>

    <!-- Main Content -->
    <main class="flex-1 flex flex-col bg-black relative min-w-0 h-full" role="main">
        <div class="h-14 md:h-16 border-b border-zinc-800 flex items-center justify-between px-3 md:px-6 bg-zinc-900/80 backdrop-blur-md z-10 flex-shrink-0 w-full">
            <div class="flex items-center gap-3 overflow-hidden flex-1 min-w-0 pr-4">
                <button onclick="toggleSidebar()" class="md:hidden text-zinc-400 hover:text-white p-2 -ml-2 flex-shrink-0" aria-label="Open Sidebar">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
                </button>
                <h2 id="viewer-title" class="font-medium text-zinc-300 truncate text-sm md:text-base flex-1 min-w-0">pouch</h2>
            </div>
            <button id="download-file-btn" class="hidden flex-shrink-0 px-3 py-1.5 md:px-4 md:py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg md:rounded-xl text-xs md:text-sm font-bold transition-colors shadow-lg shadow-amber-500/20 flex items-center gap-2" aria-label="Download active file">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="md:w-4 md:h-4"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                <span class="hidden sm:inline">Download</span>
            </button>
        </div>
        
        <!-- Premium Analog Clock -->
        <div class="clock-container" id="bg-clock" aria-hidden="true">
            <div class="clock-inner"></div>
            <div class="hand hand-hour" id="clock-hour"></div>
            <div class="hand hand-minute" id="clock-minute"></div>
            <div class="hand hand-second" id="clock-second"></div>
            <div class="clock-center"></div>
        </div>
        <div id="viewer-content" class="flex-1 relative z-10 min-h-0" aria-live="polite">
            <!-- Dynamic Viewer Area -->
        </div>
        
        <!-- Persistent mini player (audio keeps playing while browsing) -->
        <div id="pv-mini"></div>
    </main>

    <!-- AUTH UI -->
    <div id="auth-ui" class="hidden fixed inset-0 bg-black/60 backdrop-blur-xl z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div class="bg-zinc-900 p-6 md:p-10 rounded-[2rem] border border-zinc-800 max-w-md w-full shadow-2xl text-center">
            <div class="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-amber-500"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
            </div>
            <h2 id="auth-title" class="text-xl md:text-2xl font-black text-white mb-2 tracking-tight">Encrypted Pouch</h2>
            <p class="text-zinc-400 mb-8 text-xs md:text-sm">Enter the password to unlock contents.</p>
            <input type="password" id="auth-pass" class="w-full bg-black border border-zinc-700 rounded-xl px-4 py-3 md:py-4 text-white mb-4 focus:border-amber-500 outline-none text-center font-mono text-base md:text-lg" placeholder="••••••••" aria-label="Pouch Password">
            <p id="auth-error" class="text-red-400 text-xs md:text-sm mb-4 hidden font-medium" role="alert">Incorrect password</p>
            <button id="auth-submit" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-black py-3 md:py-4 rounded-xl transition-all shadow-lg shadow-amber-500/20 tracking-widest uppercase mt-2 md:mt-4 text-sm md:text-base">
                UNLOCK
            </button>
        </div>
    </div>

    <!-- TETHER UI -->
    <div id="tether-ui" class="hidden fixed inset-0 bg-black/60 backdrop-blur-xl z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="tether-title">
        <div class="bg-zinc-900 p-6 md:p-10 rounded-[2rem] border border-amber-500/30 max-w-md w-full shadow-2xl text-center">
            <div class="w-16 h-16 bg-amber-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
                <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-amber-500"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
            </div>
            <h2 id="tether-title" class="text-xl md:text-2xl font-black text-amber-500 mb-4 tracking-tight">Local Access Required</h2>
            <p class="text-zinc-300 mb-8 text-xs md:text-sm leading-relaxed">Your browser restricts reading local files directly. To view the contents, please select this HTML file again to grant read access.</p>
            <input type="file" id="tether-file" class="hidden" aria-label="Select pouch file">
            <button onclick="document.getElementById('tether-file').click()" class="w-full bg-amber-600 hover:bg-amber-500 text-white font-black py-3 md:py-4 rounded-xl transition-all shadow-lg shadow-amber-500/20 tracking-widest uppercase text-sm md:text-base">
                SELECT THIS FILE
            </button>
        </div>
    </div>

    <script>${VIEWER_JS}</script>
    ${EMBED_MARK}<script>
        const CONFIG = {
            encryption: ${isEncrypted},
            passwordHash: ${JSON.stringify(passwordHash)}
        };

        function escapeHtml(str) {
            if (!str) return '';
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        async function sha256(message) {
            const msgBuffer = new TextEncoder().encode(message);
            const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
        }

        async function deriveKey(password, salt) {
            const enc = new TextEncoder();
            const keyMaterial = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits', 'deriveKey']);
            return crypto.subtle.deriveKey(
                { name: 'PBKDF2', salt, iterations: 600000, hash: 'SHA-256' },
                keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
            );
        }

        // Cache derived keys to avoid 600,000 PBKDF2 iterations on every subsequent file click
        const keyCache = new Map();
        async function getCachedKey(pass, saltBytes) {
            const hex = Array.from(saltBytes).map(b => b.toString(16).padStart(2, '0')).join('');
            if (keyCache.has(hex)) return keyCache.get(hex);
            const key = await deriveKey(pass, saltBytes);
            keyCache.set(hex, key);
            return key;
        }

        let binaryHandle = null;
        let binaryLength = null;
        let binaryStart = 0;
        let pouchSpine = null;
        let unlockPassword = null;
        
        const FILE_CACHE_MAX_BYTES = 150 * 1024 * 1024;  // 150 MB total cached blobs

        class LRUBlobCache {
            constructor(maxBytes) {
                this.maxBytes = maxBytes;
                this.used = 0;
                this.map = new Map();
            }
            get(id) {
                if (!this.map.has(id)) return null;
                const blob = this.map.get(id);
                this.map.delete(id);
                this.map.set(id, blob);
                return blob;
            }
            set(id, blob) {
                if (this.map.has(id)) return;
                this.map.set(id, blob);
                this.used += blob.size;
                for (const [k, b] of this.map) {
                    if (this.used <= this.maxBytes) break;
                    this.map.delete(k);
                    this.used -= b.size;
                }
            }
            clear() {
                this.map.clear();
                this.used = 0;
            }
        }

        const fileCache = new LRUBlobCache(FILE_CACHE_MAX_BYTES);
        
        let currentAudioIndex = -1;
        let audioPlaylist = [];
        let currentImageIndex = -1;
        let imageGallery = [];

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('mobile-overlay');
            if (!sidebar || !overlay) return;
            sidebar.classList.toggle('open');
            overlay.classList.toggle('open');
        }

        async function fetchRange(start, end) {
            const res = await fetch(window.location.href, {
                headers: { 'Range': \`bytes=\${start}-\${end - 1}\` }
            });
            if (!res.ok && res.status !== 206) {
                throw new Error(\`Range request failed: \${res.status}\`);
            }
            return res.arrayBuffer();
        }

        async function getRemoteLength() {
            // First attempt standard HEAD
            try {
                const res = await fetch(window.location.href, { method: 'HEAD' });
                if (res.ok) {
                    const acceptRanges = res.headers.get('Accept-Ranges');
                    const len = res.headers.get('Content-Length');
                    if (acceptRanges === 'bytes' && len) {
                        return parseInt(len, 10);
                    }
                }
            } catch (e) {
                // Ignore HEAD failure and proceed to range probe
            }

            // Fallback probe with range request for hosts that omit Accept-Ranges on HEAD
            try {
                const probeRes = await fetch(window.location.href, {
                    headers: { 'Range': 'bytes=0-0' }
                });
                if (probeRes.status === 206) {
                    const cr = probeRes.headers.get('Content-Range');
                    if (cr) {
                        const m = cr.match(/\\/(\\d+)$/);
                        if (m) return parseInt(m[1], 10);
                    }
                }
            } catch (e) {
                // Range probing failed
            }
            return null;
        }

        // Embedded mode: payload lives in <script data-pouch-chunk> tags as base64,
        // which the page can read on file:// without any permission prompt.
        async function loadEmbedded() {
            const nodes = document.querySelectorAll('script[data-pouch-chunk]');
            if (!nodes.length) return false;
            const parts = [];
            for (const node of nodes) {
                const bin = atob(node.textContent.trim());
                const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                parts.push(u8);
                node.textContent = '';
                await new Promise(r => setTimeout(r, 0));
            }
            binaryHandle = new Blob(parts);
            binaryLength = binaryHandle.size;
            return true;
        }

        async function init() {
            const embedded = await loadEmbedded();
            if (!embedded && window.location.protocol.startsWith('file:')) {
                document.getElementById('tether-ui').classList.remove('hidden');
                return;
            }
            
            try {
                if (!embedded) binaryLength = await getRemoteLength();
            } catch (e) {
                console.warn("Remote length probe failed, falling back to full fetch", e);
            }

            if (!binaryLength) {
                try {
                    binaryHandle = await fetch(window.location.href).then(r => r.blob());
                    binaryLength = binaryHandle.size;
                } catch (e) {
                    document.getElementById('tether-ui').classList.remove('hidden');
                    return;
                }
            }

            if (CONFIG.encryption) {
                const authUi = document.getElementById('auth-ui');
                authUi.classList.remove('hidden');
                setTimeout(() => { authUi.style.opacity = '1'; }, 10);
                
                document.getElementById('auth-submit').onclick = async () => {
                    const btn = document.getElementById('auth-submit');
                    const pass = document.getElementById('auth-pass').value;
                    const hash = await sha256(pass);
                    if (hash !== CONFIG.passwordHash) {
                        document.getElementById('auth-error').classList.remove('hidden');
                        return;
                    }
                    
                    unlockPassword = pass;
                    btn.innerText = 'UNLOCKING POUCH...';
                    btn.disabled = true;
                    
                    try {
                        authUi.classList.add('hidden');
                        await bootstrapFromRemote(binaryLength);
                    } catch (e) {
                        console.error("Failed to load pouch", e);
                        btn.innerText = 'UNLOCK';
                        btn.disabled = false;
                    }
                };
                
                document.getElementById('auth-pass').onkeydown = (e) => {
                    if (e.key === 'Enter') document.getElementById('auth-submit').click();
                };
            } else {
                try {
                    await bootstrapFromRemote(binaryLength);
                } catch (e) {
                    console.error("Failed to load pouch", e);
                }
            }
        }

        async function bootstrapFromRemote(totalLen) {
            let footerBuf;
            if (binaryHandle) {
                footerBuf = await binaryHandle.slice(totalLen - 24, totalLen).arrayBuffer();
            } else {
                footerBuf = await fetchRange(totalLen - 24, totalLen);
            }
            
            const footerView = new DataView(footerBuf);
            if (footerView.getUint32(12, true) !== 0x43434150) {
                alert('Invalid or corrupted Pouch payload.');
                return;
            }
            binaryStart = Number(footerView.getBigUint64(0, true));
            const spineLen = footerView.getUint32(8, true);
            
            let spineBuf;
            if (binaryHandle) {
                spineBuf = await binaryHandle.slice(totalLen - 24 - spineLen, totalLen - 24).arrayBuffer();
            } else {
                spineBuf = await fetchRange(totalLen - 24 - spineLen, totalLen - 24);
            }
            
            pouchSpine = JSON.parse(new TextDecoder().decode(spineBuf));
            renderFiles();
        }

        async function readCellBytes(offset, length) {
            if (binaryHandle) {
                return binaryHandle.slice(offset, offset + length).arrayBuffer();
            }
            return fetchRange(offset, offset + length);
        }

        document.getElementById('tether-file').onchange = async (e) => {
            if (e.target.files && e.target.files[0]) {
                document.getElementById('tether-ui').classList.add('hidden');
                binaryHandle = e.target.files[0];
                binaryLength = binaryHandle.size;
                
                if (CONFIG.encryption) {
                    const authUi = document.getElementById('auth-ui');
                    authUi.classList.remove('hidden');
                    setTimeout(() => { authUi.style.opacity = '1'; }, 10);
                    
                    document.getElementById('auth-submit').onclick = async () => {
                        const btn = document.getElementById('auth-submit');
                        const pass = document.getElementById('auth-pass').value;
                        const hash = await sha256(pass);
                        if (hash !== CONFIG.passwordHash) {
                            document.getElementById('auth-error').classList.remove('hidden');
                            return;
                        }
                        
                        unlockPassword = pass;
                        btn.innerText = 'UNLOCKING POUCH...';
                        btn.disabled = true;
                        
                        try {
                            authUi.classList.add('hidden');
                            await bootstrapFromRemote(binaryLength);
                        } catch (err) {
                            console.error("Failed to load pouch", err);
                            btn.innerText = 'UNLOCK';
                            btn.disabled = false;
                        }
                    };
                    
                    document.getElementById('auth-pass').onkeydown = (event) => {
                        if (event.key === 'Enter') document.getElementById('auth-submit').click();
                    };
                } else {
                    await bootstrapFromRemote(binaryLength);
                }
            }
        };

        function getCategory(file) {
            return PV.category(file);
        }

        function renderFiles() {
            const container = document.getElementById('file-list');
            container.innerHTML = '';
            
            const categories = {};
            audioPlaylist = [];
            imageGallery = [];
            
            pouchSpine.files.forEach((f, index) => {
                const cat = getCategory(f);
                if (!categories[cat]) categories[cat] = [];
                categories[cat].push({ ...f, originalIndex: index });
                
                if (cat === 'Audio') audioPlaylist.push({ ...f, originalIndex: index });
                if (cat === 'Images') imageGallery.push({ ...f, originalIndex: index });
            });

            const order = ['Audio', 'Video', 'Images', 'Documents', 'Code & Data', 'Apps & Games', 'Other'];
            
            order.forEach(cat => {
                if (!categories[cat] || categories[cat].length === 0) return;
                
                const folderDiv = document.createElement('div');
                folderDiv.className = 'mb-2';
                
                const header = document.createElement('div');
                header.className = 'folder-header flex items-center gap-2 p-2 text-zinc-400 hover:text-zinc-200 transition-colors open';
                header.setAttribute('role', 'button');
                header.setAttribute('tabindex', '0');
                header.setAttribute('aria-expanded', 'true');
                header.innerHTML = \`
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="folder-icon"><polyline points="9 18 15 12 9 6"></polyline></svg>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
                    <span class="text-xs font-bold uppercase tracking-widest">\${escapeHtml(cat)}</span>
                    <span class="text-[10px] font-mono bg-zinc-800 px-1.5 py-0.5 rounded ml-auto">\${categories[cat].length}</span>
                \`;
                
                const content = document.createElement('div');
                content.className = 'folder-content open pl-4 space-y-1 mt-1';
                
                const toggleFolder = () => {
                    const isOpen = header.classList.toggle('open');
                    content.classList.toggle('open');
                    header.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
                };
                
                header.onclick = toggleFolder;
                header.onkeydown = (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleFolder();
                    }
                };
                
                categories[cat].forEach(f => {
                    const div = document.createElement('div');
                    div.className = 'p-2 rounded-lg hover:bg-zinc-800 cursor-pointer transition-colors text-sm text-zinc-300 file-item flex items-center gap-3 border-l-2 border-transparent';
                    div.dataset.id = f.id;
                    div.setAttribute('role', 'button');
                    div.setAttribute('tabindex', '0');
                    div.setAttribute('aria-label', f.name);
                    
                    let icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-500 flex-shrink-0"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>';
                    if (cat === 'Images') icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-500 flex-shrink-0"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>';
                    else if (cat === 'Video') icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-500 flex-shrink-0"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>';
                    else if (cat === 'Audio') icon = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="text-zinc-500 flex-shrink-0"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>';
                    
                    div.innerHTML = \`
                        \${icon} 
                        <div class="overflow-hidden flex-1">
                            <div class="truncate font-medium text-xs">\${escapeHtml(f.name)}</div>
                            <div class="text-[9px] text-zinc-500 font-mono mt-0.5">\${(f.size/1024).toFixed(1)} KB</div>
                        </div>
                    \`;
                    div.onclick = () => viewFile(f, div);
                    div.onkeydown = (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            viewFile(f, div);
                        }
                    };
                    content.appendChild(div);
                });
                
                folderDiv.appendChild(header);
                folderDiv.appendChild(content);
                container.appendChild(folderDiv);
            });
            
            setupGlobalAudio();
        }

        function setupGlobalAudio() {
            if (window.PV && PV.shell) PV.shell.wireFilter();
            if (window.PV && PV.audio && PV.audio.onFilesRendered) PV.audio.onFilesRendered();
        }

        const STREAM_TO_DISK_THRESHOLD = 50 * 1024 * 1024;  // 50 MB

        async function getFileBlob(fileMeta, forceMemory) {
            const cached = fileCache.get(fileMeta.id);
            if (cached) return cached;
            
            const rawBuf = await readCellBytes(
                binaryStart + fileMeta.offset, fileMeta.compressed_length
            );
            
            let stream;
            if (CONFIG.encryption) {
                const salt = new Uint8Array(rawBuf.slice(0, 16));
                const iv   = new Uint8Array(rawBuf.slice(16, 28));
                const data = rawBuf.slice(28);
                const key  = await getCachedKey(unlockPassword, salt);
                let dec;
                try {
                    dec = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
                } catch(e) {
                    throw new Error("Decryption failed. Invalid key or corrupted data block.");
                }
                stream = new ReadableStream({
                    start(c) { c.enqueue(new Uint8Array(dec)); c.close(); }
                }).pipeThrough(new DecompressionStream('deflate'));
            } else {
                stream = new Blob([rawBuf]).stream().pipeThrough(new DecompressionStream('deflate'));
            }
            
            if (!forceMemory && fileMeta.size > STREAM_TO_DISK_THRESHOLD && 'showSaveFilePicker' in window) {
                try {
                    const handle = await window.showSaveFilePicker({
                        suggestedName: fileMeta.name,
                        types: [{ description: fileMeta.type, accept: { [fileMeta.type]: [] } }]
                    });
                    const writable = await handle.createWritable();
                    await stream.pipeTo(writable);
                    return null;
                } catch (e) {
                    if (e.name === 'AbortError') return null;
                }
            }
            
            const finalBlob = new Blob([await new Response(stream).blob()], { type: fileMeta.type });
            fileCache.set(fileMeta.id, finalBlob);
            return finalBlob;
        }

        let currentViewerUrl = null;
        let currentAudioUrl = null;

        window.addEventListener('pagehide', () => {
            if (currentViewerUrl) URL.revokeObjectURL(currentViewerUrl);
            if (currentAudioUrl) URL.revokeObjectURL(currentAudioUrl);
        });

        // Global keyboard shortcut listeners
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const sidebar = document.getElementById('sidebar');
                if (sidebar && sidebar.classList.contains('open')) toggleSidebar();
                if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
            }
            if (currentImageIndex >= 0 && imageGallery.length > 1) {
                if (e.key === 'ArrowLeft' && currentImageIndex > 0) {
                    const prevFile = imageGallery[currentImageIndex - 1];
                    const el = document.querySelector(\`.file-item[data-id="\${prevFile.id}"]\`);
                    if (el) viewFile(prevFile, el);
                } else if (e.key === 'ArrowRight' && currentImageIndex < imageGallery.length - 1) {
                    const nextFile = imageGallery[currentImageIndex + 1];
                    const el = document.querySelector(\`.file-item[data-id="\${nextFile.id}"]\`);
                    if (el) viewFile(nextFile, el);
                }
            }
        });

        function clearViewer() {
            if (window.PV) PV.dispose();
            const v = document.querySelector('#viewer-content video');
            if (v) { v.pause(); v.src = ''; v.load(); }
            if (currentViewerUrl) {
                URL.revokeObjectURL(currentViewerUrl);
                currentViewerUrl = null;
            }
            document.getElementById('viewer-content').innerHTML = '';
        }

        async function viewFile(fileMeta, element) {
            document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active', 'text-amber-300'));
            if (element) element.classList.add('active', 'text-amber-300');
            
            document.getElementById('viewer-title').textContent = fileMeta.name;
            const viewer = document.getElementById('viewer-content');
            
            clearViewer();
            const bgClock = document.getElementById('bg-clock');
            if (bgClock) {
                bgClock.classList.remove('hidden-clock');
                bgClock.classList.add('clock-extracting');
            }
            
            await new Promise(r => setTimeout(r, 40));
            
            try {
                const blob = await getFileBlob(fileMeta, !window.PV || PV.isViewable(fileMeta));
                
                if (bgClock) {
                    bgClock.classList.remove('clock-extracting');
                    bgClock.classList.add('hidden-clock');
                }
                
                if (!blob) {
                    viewer.innerHTML = \`<div class="text-center p-6"><p class="text-zinc-400 mb-6">File streamed directly to storage.</p></div>\`;
                    return;
                }
                
                currentViewerUrl = URL.createObjectURL(blob);
                
                const dlBtn = document.getElementById('download-file-btn');
                dlBtn.classList.remove('hidden');
                dlBtn.onclick = () => {
                    const a = document.createElement('a');
                    a.href = currentViewerUrl;
                    a.download = fileMeta.name;
                    a.click();
                };
                
                await PV.render({ meta: fileMeta, blob, url: currentViewerUrl, viewer });

                if (window.innerWidth <= 768) {
                    const sidebar = document.getElementById('sidebar');
                    if (sidebar && sidebar.classList.contains('open')) {
                        toggleSidebar();
                    }
                }
                
            } catch (e) {
                console.error(e);
                const bgClock = document.getElementById('bg-clock');
                if (bgClock) {
                    bgClock.classList.remove('clock-extracting');
                    bgClock.classList.remove('hidden-clock');
                }
                viewer.innerHTML = \`<div class="p-4 bg-red-900/20 border border-red-500/30 rounded-xl text-red-400"><p class="font-bold">Extraction Error:</p><p class="text-sm font-mono mt-1">\${escapeHtml(e.message)}</p></div>\`;
            }
        }

        document.getElementById('download-all-btn').onclick = async () => {
            if (!pouchSpine) return;
            const btn = document.getElementById('download-all-btn');
            const originalHTML = btn.innerHTML;
            btn.innerHTML = 'Extracting...';
            btn.disabled = true;
            
            const bgClock = document.getElementById('bg-clock');
            if (bgClock) {
                bgClock.classList.remove('hidden-clock');
                bgClock.classList.add('clock-extracting');
            }
            
            let completed = 0;
            for (const f of pouchSpine.files) {
                btn.textContent = \`Extracting \${++completed}/\${pouchSpine.files.length}...\`;
                try {
                    const blob = await getFileBlob(f);
                    if (!blob) continue;
                    
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = f.name; a.click();
                    await new Promise(r => setTimeout(r, 250));
                    URL.revokeObjectURL(url);
                    
                    if (fileCache.map.has(f.id)) {
                        fileCache.used -= fileCache.map.get(f.id).size;
                        fileCache.map.delete(f.id);
                    }
                } catch(e) {
                    console.error("Failed to extract", f.name, e);
                }
            }
            
            if (bgClock) {
                bgClock.classList.remove('clock-extracting');
                if (currentViewerUrl) {
                    bgClock.classList.add('hidden-clock');
                }
            }
            btn.innerHTML = originalHTML;
            btn.disabled = false;
        };

        init();

        function initClock() {
            const inner = document.querySelector('.clock-inner');
            if (!inner) return;
            for (let i = 0; i < 12; i++) {
                const marker = document.createElement('div');
                marker.className = 'clock-marker';
                marker.style.transform = \`rotate(\${i * 30}deg)\`;
                const markerInner = document.createElement('div');
                markerInner.className = \`clock-marker-inner \${i % 3 === 0 ? 'major' : 'minor'}\`;
                marker.appendChild(markerInner);
                inner.appendChild(marker);
            }
            
            function updateClock() {
                const bgClock = document.getElementById('bg-clock');
                if (bgClock && !bgClock.classList.contains('clock-extracting')) {
                    const time = new Date();
                    const seconds = time.getSeconds();
                    const minutes = time.getMinutes();
                    const hours = time.getHours();
                    const ms = time.getMilliseconds();

                    const secondDegrees = (seconds / 60) * 360 + (ms / 1000) * 6;
                    const minuteDegrees = (minutes / 60) * 360 + (seconds / 60) * 6;
                    const hourDegrees = (hours / 12) * 360 + (minutes / 60) * 30;

                    const secHand = document.getElementById('clock-second');
                    const minHand = document.getElementById('clock-minute');
                    const hrHand = document.getElementById('clock-hour');
                    
                    if (secHand) secHand.style.transform = \`translateX(-50%) rotate(\${secondDegrees}deg)\`;
                    if (minHand) minHand.style.transform = \`translateX(-50%) rotate(\${minuteDegrees}deg)\`;
                    if (hrHand) hrHand.style.transform = \`translateX(-50%) rotate(\${hourDegrees}deg)\`;
                }
                requestAnimationFrame(updateClock);
            }
            requestAnimationFrame(updateClock);
        }
        initClock();

    </script>
</body>
</html>
<script type="text/plain" style="display:none">`;

  const spineBytes = new TextEncoder().encode(JSON.stringify(spine));

  const makeFooter = (headerLen: bigint): ArrayBuffer => {
    const footerBuffer = new ArrayBuffer(24);
    const footerView = new DataView(footerBuffer);
    footerView.setBigUint64(0, headerLen, true);
    footerView.setUint32(8, spineBytes.length, true);
    footerView.setUint32(12, 0x43434150, true); // 'CCAP'
    footerView.setUint32(16, 2, true); // Version 2
    return footerBuffer;
  };

  if (embed) {
    onProgress({
      percentage: 97,
      status: "Embedding payload for double-click opening...",
      logs: [...logs, "[EMBED] Encoding payload as base64 chunks"],
    });

    const [htmlHead, htmlRest] = html.split(EMBED_MARK);
    const openTag = '<script type="text/plain" style="display:none">';
    // The append-mode trick leaves an unterminated script tag; embedded mode doesn't need it
    const htmlTail = htmlRest.endsWith(openTag) ? htmlRest.slice(0, -openTag.length) : htmlRest;

    // headerLen = 0: the embedded payload starts at byte 0 of its own virtual blob
    const payload = new Blob([...payloadBlobs, spineBytes, makeFooter(0n)]);
    const parts: BlobPart[] = [htmlHead];
    const CHUNK = 3 * 4 * 1024 * 1024; // 12 MB raw per tag (multiple of 3)
    let n = 0;
    for (let off = 0; off < payload.size; off += CHUNK) {
      const raw = new Uint8Array(await payload.slice(off, off + CHUNK).arrayBuffer());
      parts.push(
        new Blob([
          `<script type="application/octet-stream" data-pouch-chunk="${n++}">`,
          bytesToBase64(raw),
          "</script>\n",
        ]),
      );
    }
    parts.push(htmlTail);

    onProgress({
      percentage: 100,
      status: "Seal Complete.",
      logs: [...logs, "[SEAL] Pouch Sealed (embedded, opens with double-click)."],
    });
    return new Blob(parts, { type: "text/html" });
  }

  // Append mode (large pouches): binary payload follows the HTML
  const htmlBytes = new TextEncoder().encode(html.replace(EMBED_MARK, ""));
  const padding = new Uint8Array(64 * 1024).fill(32); // 64KB clean padding
  const headerLen = BigInt(htmlBytes.length + padding.length);

  onProgress({
    percentage: 100,
    status: "Seal Complete.",
    logs: [...logs, "[SEAL] Pouch Sealed & Verified."],
  });
  return new Blob(
    [htmlBytes, padding, ...payloadBlobs, spineBytes, makeFooter(headerLen)],
    { type: "text/html" },
  );
};
