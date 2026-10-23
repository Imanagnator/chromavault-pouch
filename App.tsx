import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { ProcessingProgress, FileMetadata } from "./types";
import { generateFilledPouch } from "./services/ccaGenerator";
import { PouchCreationSchema } from "./lib/validation";
import {
  formatBytes,
  getFileCategory,
  getExtBadge,
  FILE_CATEGORIES,
  calculatePasswordStrength,
  generateStrongPassword,
} from "./lib/utils";
import {
  UploadCloud,
  Lock,
  Unlock,
  Eye,
  EyeOff,
  Sparkles,
  Check,
  X,
  AlertTriangle,
  AlertCircle,
  KeyRound,
  Download,
  Copy,
  CheckCheck,
  RefreshCcw,
  ArrowLeft,
  Plus,
  ShieldCheck,
  Layers,
  FileCode,
} from "lucide-react";

interface AlertItem {
  id: string;
  type: "err" | "warn";
  title: string;
  message: string;
}

/**
 * Precision Mini Analog Clock (Ticking in Real-Time in the Header)
 */
const MiniClock: React.FC = () => {
  const [rotation, setRotation] = useState({ h: 0, m: 0, s: 0 });

  useEffect(() => {
    let animId: number;
    const update = () => {
      const now = new Date();
      const s = now.getSeconds();
      const ms = now.getMilliseconds();
      const m = now.getMinutes() + s / 60;
      const h = (now.getHours() % 12) + m / 60;

      setRotation({
        h: h * 30,
        m: m * 6,
        s: s * 6 + (ms / 1000) * 6,
      });
      animId = requestAnimationFrame(update);
    };
    animId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <svg
      className="w-[34px] h-[34px] flex-none select-none"
      viewBox="0 0 34 34"
      role="img"
      aria-label="Real-time precision clock"
    >
      <circle cx="17" cy="17" r="15.5" fill="#151311" stroke="rgba(255,255,255,0.14)" strokeWidth="1.2" />
      {/* Hour Hand */}
      <line
        x1="17"
        y1="17"
        x2="17"
        y2="9.5"
        stroke="#ffb547"
        strokeWidth="2.2"
        strokeLinecap="round"
        transform={`rotate(${rotation.h} 17 17)`}
      />
      {/* Minute Hand */}
      <line
        x1="17"
        y1="17"
        x2="17"
        y2="6.5"
        stroke="#f4efe8"
        strokeWidth="1.6"
        strokeLinecap="round"
        transform={`rotate(${rotation.m} 17 17)`}
      />
      {/* Second Hand */}
      <line
        x1="17"
        y1="19"
        x2="17"
        y2="5.5"
        stroke="#ff5d8f"
        strokeWidth="1"
        strokeLinecap="round"
        transform={`rotate(${rotation.s} 17 17)`}
      />
      {/* Center Pin */}
      <circle cx="17" cy="17" r="1.8" fill="#ffb547" />
    </svg>
  );
};

export const App: React.FC = () => {
  // App views: 'build' | 'busy' | 'done'
  const [viewMode, setViewMode] = useState<"build" | "busy" | "done">("build");

  // Core state
  const [pouchName, setPouchName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [copiedPass, setCopiedPass] = useState(false);

  // Global Drag & Drop state
  const [isDraggingOverWindow, setIsDraggingOverWindow] = useState(false);
  const dragDepthRef = useRef(0);

  // Packaging progress & result
  const [progress, setProgress] = useState<ProcessingProgress | null>(null);
  const [result, setResult] = useState<{
    blob: Blob;
    name: string;
    size: number;
    count: number;
    encrypted: boolean;
    offlineNotice?: boolean;
    metadata: FileMetadata;
  } | null>(null);

  // Active alerts
  const [alerts, setAlerts] = useState<AlertItem[]>([]);

  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const termRef = useRef<HTMLDivElement>(null);

  // Helper to add alerts
  const showAlert = useCallback((type: "err" | "warn", title: string, message: string) => {
    const id = `${Date.now()}-${Math.random()}`;
    setAlerts((prev) => [...prev.filter((a) => a.title !== title), { id, type, title, message }]);
    if (type === "warn") {
      setTimeout(() => {
        setAlerts((prev) => prev.filter((a) => a.id !== id));
      }, 7000);
    }
  }, []);

  const dismissAlert = (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  };

  // Name validation
  const handleNameChange = (val: string) => {
    setPouchName(val);
    const trimmed = val.trim();
    if (trimmed && !/^[a-zA-Z0-9_\-\s.]+$/.test(trimmed)) {
      setNameError("Only letters, numbers, spaces, dots, dashes and underscores.");
    } else {
      setNameError(null);
    }
  };

  const isNameValid = useMemo(() => {
    const trimmed = pouchName.trim();
    return trimmed.length > 0 && trimmed.length <= 64 && /^[a-zA-Z0-9_\-\s.]+$/.test(trimmed);
  }, [pouchName]);

  // File addition & deduplication
  const addFiles = useCallback(
    (newFiles: File[]) => {
      const MAX_FILES = 500;
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => `${f.name}|${f.size}|${f.lastModified}`));
        const toAdd: File[] = [];
        let duplicateCount = 0;

        for (const file of newFiles) {
          const key = `${file.name}|${file.size}|${file.lastModified}`;
          if (seen.has(key)) {
            duplicateCount++;
            continue;
          }
          if (prev.length + toAdd.length >= MAX_FILES) {
            showAlert(
              "warn",
              "File limit reached",
              `A pouch can hold up to ${MAX_FILES} files. Additional files were omitted.`
            );
            break;
          }
          seen.add(key);
          toAdd.push(file);
        }

        if (duplicateCount > 0 && toAdd.length === 0) {
          showAlert(
            "warn",
            "Already staged",
            `${duplicateCount} duplicate file${duplicateCount > 1 ? "s were" : " was"} skipped.`
          );
        }

        return [...prev, ...toAdd];
      });
    },
    [showAlert]
  );

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const clearAllFiles = () => {
    setFiles([]);
  };

  // Window drag & drop listeners
  useEffect(() => {
    const onWindowDragEnter = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current += 1;
      setIsDraggingOverWindow(true);
    };

    const onWindowDragOver = (e: DragEvent) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).includes("Files")) {
        e.preventDefault();
      }
    };

    const onWindowDragLeave = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
      if (dragDepthRef.current === 0) {
        setIsDraggingOverWindow(false);
      }
    };

    const onWindowDrop = (e: DragEvent) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types || []).includes("Files")) return;
      e.preventDefault();
      dragDepthRef.current = 0;
      setIsDraggingOverWindow(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        addFiles(Array.from(e.dataTransfer.files));
      }
    };

    window.addEventListener("dragenter", onWindowDragEnter);
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("dragleave", onWindowDragLeave);
    window.addEventListener("drop", onWindowDrop);

    return () => {
      window.removeEventListener("dragenter", onWindowDragEnter);
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("dragleave", onWindowDragLeave);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, [addFiles]);

  // Auto-scroll terminal log during busy packaging
  useEffect(() => {
    if (termRef.current) {
      termRef.current.scrollTop = termRef.current.scrollHeight;
    }
  }, [progress?.logs]);

  // Total payload size
  const totalPayloadSize = useMemo(() => {
    return files.reduce((acc, f) => acc + f.size, 0);
  }, [files]);

  // Breakdown of files by category for composition bar
  const categoryBreakdown = useMemo(() => {
    if (files.length === 0) return [];
    const map = new Map<string, number>();
    for (const f of files) {
      const cat = getFileCategory(f);
      map.set(cat, (map.get(cat) || 0) + Math.max(f.size, 1));
    }
    const sum = Array.from(map.values()).reduce((a, b) => a + b, 0);
    return Array.from(map.entries())
      .map(([catKey, bytes]) => {
        const info = FILE_CATEGORIES[catKey] || FILE_CATEGORIES.other;
        return {
          key: catKey,
          label: info.label,
          color: info.color,
          bytes,
          percentage: (bytes / sum) * 100,
        };
      })
      .sort((a, b) => b.bytes - a.bytes);
  }, [files]);

  // Password strength calculation
  const passStrength = useMemo(() => {
    return calculatePasswordStrength(password);
  }, [password]);

  // Validation checks for the live preview card
  const isFilesReady = files.length > 0;
  const isPasswordReady = !isEncrypted || password.trim().length > 0;
  const canGenerate = isNameValid && isFilesReady && isPasswordReady;

  // Handle password generator
  const handleGeneratePassword = () => {
    const newPass = generateStrongPassword(20);
    setPassword(newPass);
    setShowPassword(true);
    setCopiedPass(false);
  };

  const handleCopyPassword = async () => {
    if (!password) return;
    try {
      await navigator.clipboard.writeText(password);
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    } catch {
      // Fallback
      setCopiedPass(true);
      setTimeout(() => setCopiedPass(false), 2000);
    }
  };

  // Generate pouch execution
  const handleGeneratePouch = async () => {
    const trimmedName = pouchName.trim();
    const effectivePassword = isEncrypted && password.trim() ? password.trim() : null;

    const validation = PouchCreationSchema.safeParse({
      name: trimmedName,
      files,
      password: effectivePassword,
    });

    if (!validation.success) {
      showAlert("err", "Validation failure", validation.error.issues.map((i) => i.message).join(". "));
      return;
    }

    setViewMode("busy");
    setProgress({ percentage: 0, status: "Starting up", logs: [] });
    setAlerts([]);

    await new Promise((r) => setTimeout(r, 80));

    try {
      const blob = await generateFilledPouch(
        trimmedName,
        files.slice(),
        effectivePassword,
        (p: ProcessingProgress) => setProgress(p)
      );

      // Check offline script availability in generated pouch
      let offlineNotice = false;
      try {
        const headText = await blob.slice(0, 6000).text();
        offlineNotice = /<script src="https:\/\/(unpkg|cdnjs)/.test(headText);
      } catch {
        // Ignore
      }

      setResult({
        blob,
        name: trimmedName,
        size: blob.size,
        count: files.length,
        encrypted: !!effectivePassword,
        offlineNotice,
        metadata: {
          name: trimmedName,
          type: "text/html",
          size: blob.size,
          timestamp: Date.now(),
          totalPages: 1,
          isEncrypted: !!effectivePassword,
        },
      });

      setViewMode("done");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (err: any) {
      console.error("Pouch packaging failed", err);
      setViewMode("build");
      showAlert("err", "Could not build the pouch", err?.message || "An unexpected error occurred.");
    }
  };

  // Download generated pouch
  const handleDownloadPouch = () => {
    if (!result) return;
    const safeName = result.name.replace(/\s+/g, "_");
    const filename = `chromavault-pouch_${safeName}.html`;
    const url = URL.createObjectURL(result.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  // Reset to create another pouch
  const handleStartNew = () => {
    setPouchName("");
    setNameError(null);
    setFiles([]);
    setIsEncrypted(false);
    setPassword("");
    setShowPassword(false);
    setResult(null);
    setProgress(null);
    setAlerts([]);
    setViewMode("build");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const CIRCLE_CIRCUMFERENCE = 326.7;
  const progressOffset = CIRCLE_CIRCUMFERENCE * (1 - (progress?.percentage || 0) / 100);

  return (
    <div className="min-h-screen relative text-[#f4efe8] flex flex-col justify-between selection:bg-[#ffb547]/30 selection:text-white">
      {/* Ambient background glow & grid overlay */}
      <div className="ambient" aria-hidden="true">
        <div className="grid-bg" />
      </div>

      {/* Full-window Drag & Drop Overlay */}
      {isDraggingOverWindow && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#080706]/85 backdrop-blur-md pointer-events-none transition-opacity duration-200"
          aria-hidden="true"
        >
          <div className="text-center p-12 md:p-16 border-2 border-dashed border-[#ffb547] rounded-[32px] bg-[#ffb547]/5">
            <h2 className="font-serif text-4xl md:text-5xl text-white mb-2">Drop to stage files</h2>
            <p className="font-mono text-xs uppercase tracking-[0.2em] text-[#ffb547]">Release anywhere</p>
          </div>
        </div>
      )}

      {/* Main Content Container */}
      <div className="w-full max-w-[1160px] mx-auto px-5 relative z-10">
        {/* Top bar */}
        <header className="flex items-center justify-between gap-4 py-5 border-b border-white/[0.06] mb-4">
          <div className="flex items-center gap-3">
            <svg
              className="w-[34px] h-[34px] flex-none drop-shadow-[0_4px_14px_rgba(255,93,143,0.35)]"
              viewBox="0 0 32 32"
              aria-hidden="true"
            >
              <defs>
                <linearGradient id="brand-grad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#ffb547" />
                  <stop offset="52%" stopColor="#ff5d8f" />
                  <stop offset="100%" stopColor="#6d5dfc" />
                </linearGradient>
              </defs>
              <path d="M16 2l12 7v14l-12 7L4 23V9z" fill="url(#brand-grad)" />
              <path d="M16 9l6 3.5v7L16 23l-6-3.5v-7z" fill="#0b0a09" opacity="0.84" />
              <circle cx="16" cy="16" r="2.6" fill="url(#brand-grad)" />
            </svg>
            <div>
              <div className="font-semibold text-[17px] leading-none tracking-tight">
                chromavault
                <span className="bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] bg-clip-text text-transparent">
                  -pouch
                </span>
              </div>
              <small className="block font-mono text-[10.5px] leading-none text-[#6f685e] tracking-[0.14em] uppercase mt-1">
                Offline pouch maker
              </small>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <span className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 border border-white/[0.08] rounded-full bg-white/[0.03] text-xs font-medium text-[#a39b8f] whitespace-nowrap">
              <i className="w-1.5 h-1.5 rounded-full bg-[#4ade80] shadow-[0_0_8px_#4ade80]" />
              Runs in your browser
            </span>
            <MiniClock />
          </div>
        </header>

        {/* Hero Section */}
        {viewMode === "build" && (
          <section className="pt-6 pb-8 max-w-[760px]" id="hero">
            <div className="font-mono text-[11px] leading-none tracking-[0.18em] uppercase text-[#ffb547] flex items-center gap-2.5">
              <span className="w-6 h-[1px] bg-[#ffb547]" />
              HDA · CCA protocol
            </div>
            <h1 className="font-serif text-[clamp(36px,5.5vw,62px)] leading-[1.04] tracking-[-0.02em] my-4 text-white">
              Pack anything into{" "}
              <em className="italic bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] bg-clip-text text-transparent not-italic pr-1">
                one
              </em>{" "}
              encrypted HTML file.
            </h1>
            <p className="text-[#a39b8f] text-[16.5px] leading-relaxed max-w-[620px] m-0">
              Drop in your files, set an optional password, and get a single self-opening pouch with built-in
              viewers for images, video, audio, PDFs, documents and code. Nothing is ever uploaded.
            </p>
          </section>
        )}

        {/* Global Alerts Feed */}
        {alerts.length > 0 && (
          <div className="space-y-3 mb-6" aria-live="polite">
            {alerts.map((alert) => (
              <div
                key={alert.id}
                role={alert.type === "err" ? "alert" : "status"}
                className={`flex items-start gap-3 p-3.5 px-4 rounded-2xl text-sm border animate-in fade-in slide-in-from-top-1 ${
                  alert.type === "err"
                    ? "bg-[#ff6b6b]/10 border-[#ff6b6b]/30 text-[#ffd3d3]"
                    : "bg-[#fbbf24]/10 border-[#fbbf24]/30 text-[#fde9b0]"
                }`}
              >
                {alert.type === "err" ? (
                  <AlertCircle className="w-4 h-4 text-[#ff6b6b] mt-0.5 flex-none" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-[#fbbf24] mt-0.5 flex-none" />
                )}
                <div className="flex-1 min-w-0">
                  <b className="block font-semibold mb-0.5">{alert.title}</b>
                  <span className="text-xs leading-normal opacity-90">{alert.message}</span>
                </div>
                <button
                  type="button"
                  onClick={() => dismissAlert(alert.id)}
                  className="text-inherit opacity-70 hover:opacity-100 p-1 text-lg leading-none"
                  aria-label="Dismiss alert"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* VIEW 1: BUILD MODE */}
        {viewMode === "build" && (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-6 items-start pb-10">
            {/* Left Column: Pouch Setup Steps */}
            <section
              className="bg-gradient-to-b from-[#151311] to-[#100f0d] border border-white/[0.08] rounded-3xl shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] divide-y divide-white/[0.08]"
              aria-label="Pouch settings"
            >
              {/* Step 1: Name your pouch */}
              <div className="p-6 md:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-6 h-6 rounded-full grid place-items-center font-mono font-semibold text-xs text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] flex-none">
                    1
                  </span>
                  <h2 className="font-semibold text-base text-white tracking-tight">Name your pouch</h2>
                  <span className="ml-auto font-mono text-[11px] text-[#ff5d8f] tracking-wider uppercase font-semibold">
                    Required
                  </span>
                </div>

                <div className="relative">
                  <input
                    id="pouch-name"
                    type="text"
                    maxLength={64}
                    autoComplete="off"
                    spellCheck="false"
                    placeholder="e.g. Project_Alpha_Archive"
                    value={pouchName}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className={`w-full bg-[#0b0a09] border rounded-xl px-4 py-3 text-[#f4efe8] placeholder:text-[#6f685e] transition-all text-sm outline-none ${
                      nameError
                        ? "border-[#ff6b6b] focus:ring-4 focus:ring-[#ff6b6b]/15"
                        : "border-white/[0.14] focus:border-[#ffb547] focus:ring-4 focus:ring-[#ffb547]/15 hover:border-white/[0.22]"
                    }`}
                    aria-label="Pouch name"
                    aria-describedby="name-hint"
                  />
                </div>

                <div className="flex justify-between items-center text-xs mt-2 px-0.5 text-[#6f685e]" id="name-hint">
                  <span className={nameError ? "text-[#ff6b6b]" : ""}>
                    {nameError || "Letters, numbers, spaces, dots, dashes, underscores."}
                  </span>
                  <span className="font-mono text-[11px] tabular-nums">{pouchName.length}/64</span>
                </div>
              </div>

              {/* Step 2: Add files */}
              <div className="p-6 md:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-6 h-6 rounded-full grid place-items-center font-mono font-semibold text-xs text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] flex-none">
                    2
                  </span>
                  <h2 className="font-semibold text-base text-white tracking-tight">Add files</h2>
                  <span className="ml-auto font-mono text-[11px] text-[#ff5d8f] tracking-wider uppercase font-semibold">
                    Required
                  </span>
                </div>

                {/* Dropzone button */}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full text-center border-1.5 border-dashed rounded-2xl transition-all cursor-pointer bg-[#0b0a09] ${
                    files.length > 0
                      ? "p-5 border-white/[0.14] hover:border-[#ffb547] hover:bg-[#ffb547]/[0.05]"
                      : "p-7 md:p-8 border-white/[0.14] hover:border-[#ffb547] hover:bg-[radial-gradient(500px_180px_at_50%_0%,rgba(255,181,71,0.14),transparent_70%)]"
                  }`}
                  aria-label="Choose files to add to pouch"
                >
                  <div className="w-12 h-12 mx-auto mb-3 rounded-2xl grid place-items-center bg-[#1b1815] border border-white/[0.14] text-[#ffb547]">
                    <UploadCloud className="w-6 h-6" />
                  </div>
                  <strong className="block text-[15px] font-semibold text-white">
                    {files.length > 0 ? "Add more files" : "Click to browse or drag files here"}
                  </strong>
                  <span className="block text-xs text-[#a39b8f] mt-1">
                    Images, video, audio, PDFs, documents, code, apps — up to 500 files
                  </span>
                </button>

                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      addFiles(Array.from(e.target.files));
                    }
                    if (fileInputRef.current) fileInputRef.current.value = "";
                  }}
                />

                {/* Staged files list */}
                {files.length > 0 && (
                  <div className="mt-5">
                    <div className="flex items-center justify-between mb-2.5 px-1 text-xs">
                      <div className="font-mono text-[#a39b8f] tracking-wider uppercase text-[11px]">
                        <b className="text-white font-bold">{files.length}</b> files ·{" "}
                        <b className="text-white font-bold">{formatBytes(totalPayloadSize)}</b>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => fileInputRef.current?.click()}
                          className="text-[#ffb547] hover:bg-[#ffb547]/10 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        >
                          + Add more
                        </button>
                        <button
                          type="button"
                          onClick={clearAllFiles}
                          className="text-[#a39b8f] hover:text-[#ff5d8f] hover:bg-[#ff5d8f]/10 px-2 py-1 rounded-lg text-xs font-medium transition-colors"
                        >
                          Clear all
                        </button>
                      </div>
                    </div>

                    <ul
                      className="border border-white/[0.08] rounded-2xl bg-[#0b0a09] max-h-64 overflow-y-auto divide-y divide-white/[0.06] text-sm"
                      aria-label="Staged files"
                    >
                      {files.map((file, idx) => {
                        const catKey = getFileCategory(file);
                        const cat = FILE_CATEGORIES[catKey] || FILE_CATEGORIES.other;
                        const ext = getExtBadge(file.name);

                        return (
                          <li
                            key={`${file.name}-${idx}`}
                            className="flex items-center gap-3 p-2.5 px-3 hover:bg-white/[0.025] transition-colors group"
                          >
                            {/* File category extension badge */}
                            <div
                              className="w-10 h-10 rounded-xl flex-none grid place-items-center font-mono font-bold text-[10px] tracking-wider"
                              style={{
                                color: cat.color,
                                backgroundColor: `color-mix(in srgb, ${cat.color} 14%, transparent)`,
                                border: `1px solid color-mix(in srgb, ${cat.color} 32%, transparent)`,
                              }}
                            >
                              {ext}
                            </div>

                            <div className="min-w-0 flex-1">
                              <span
                                className="block font-medium text-sm text-[#f4efe8] truncate"
                                title={file.name}
                              >
                                {file.name}
                              </span>
                              <span className="font-mono text-xs text-[#6f685e] block">
                                {formatBytes(file.size)} · {cat.label}
                              </span>
                            </div>

                            <button
                              type="button"
                              onClick={() => removeFile(idx)}
                              className="w-8 h-8 rounded-lg grid place-items-center text-[#6f685e] hover:text-[#ff6b6b] hover:bg-[#ff6b6b]/10 transition-colors opacity-70 group-hover:opacity-100"
                              aria-label={`Remove ${file.name}`}
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </div>

              {/* Step 3: Protect it */}
              <div className="p-6 md:p-7">
                <div className="flex items-center gap-3 mb-4">
                  <span className="w-6 h-6 rounded-full grid place-items-center font-mono font-semibold text-xs text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] flex-none">
                    3
                  </span>
                  <h2 className="font-semibold text-base text-white tracking-tight">Protect it</h2>
                  <span className="ml-auto font-mono text-[11px] text-[#6f685e] tracking-wider uppercase font-semibold">
                    Optional
                  </span>
                </div>

                {/* Switch row */}
                <label
                  htmlFor="enc-toggle"
                  className="flex items-center justify-between gap-4 p-3.5 px-4 border border-white/[0.08] hover:border-white/[0.14] rounded-xl bg-[#0b0a09] cursor-pointer transition-colors"
                >
                  <div>
                    <div className="font-semibold text-sm text-white flex items-center gap-2">
                      <Lock className="w-4 h-4 text-[#ffb547]" />
                      Encrypt with a password
                    </div>
                    <div className="text-xs text-[#a39b8f] mt-0.5">
                      AES-256-GCM · PBKDF2 with 600,000 iterations
                    </div>
                  </div>

                  <div className="relative w-12 h-7 flex-none">
                    <input
                      id="enc-toggle"
                      type="checkbox"
                      role="switch"
                      checked={isEncrypted}
                      onChange={(e) => {
                        setIsEncrypted(e.target.checked);
                        if (!e.target.checked) setPassword("");
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-full h-full bg-[#221e1a] border border-white/[0.14] rounded-full peer-checked:bg-gradient-to-r peer-checked:from-[#ffb547] peer-checked:via-[#ff5d8f] peer-checked:to-[#6d5dfc] peer-checked:border-transparent transition-all" />
                    <div className="absolute top-1 left-1 w-5 h-5 bg-[#cfc7ba] rounded-full peer-checked:translate-x-5 peer-checked:bg-white transition-transform" />
                  </div>
                </label>

                {/* Password input drawer */}
                {isEncrypted && (
                  <div className="mt-4 p-4 border border-white/[0.08] rounded-2xl bg-[#0b0a09] animate-in fade-in duration-200">
                    <div className="relative">
                      <input
                        id="pass-input"
                        type={showPassword ? "text" : "password"}
                        maxLength={128}
                        autoComplete="new-password"
                        placeholder="Choose a strong password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full bg-[#151311] border border-white/[0.14] rounded-xl px-4 py-3 text-[#f4efe8] placeholder:text-[#6f685e] font-mono text-sm focus:border-[#ffb547] focus:ring-4 focus:ring-[#ffb547]/15 outline-none pr-20"
                        aria-label="Pouch password"
                      />

                      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                        <button
                          type="button"
                          onClick={handleGeneratePassword}
                          className="w-8 h-8 rounded-lg grid place-items-center text-[#a39b8f] hover:text-white hover:bg-white/[0.08] transition-colors"
                          title="Generate a secure password"
                          aria-label="Generate a secure password"
                        >
                          <KeyRound className="w-4 h-4 text-[#ffb547]" />
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowPassword(!showPassword)}
                          className="w-8 h-8 rounded-lg grid place-items-center text-[#a39b8f] hover:text-white hover:bg-white/[0.08] transition-colors"
                          title={showPassword ? "Hide password" : "Show password"}
                          aria-label={showPassword ? "Hide password" : "Show password"}
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </div>

                    {/* Password Strength Meter */}
                    <div className="flex gap-1.5 mt-3" aria-hidden="true">
                      {[1, 2, 3, 4].map((step) => (
                        <div
                          key={step}
                          className="h-1 flex-1 rounded-full transition-colors duration-200"
                          style={{
                            backgroundColor:
                              step <= passStrength.score ? passStrength.barColor : "#221e1a",
                          }}
                        />
                      ))}
                    </div>

                    <div className="flex justify-between items-center text-xs mt-2 text-[#6f685e]">
                      <span className={`font-medium ${passStrength.colorClass}`}>{passStrength.label}</span>
                      {password && (
                        <button
                          type="button"
                          onClick={handleCopyPassword}
                          className="text-xs text-[#ffb547] hover:underline flex items-center gap-1 font-mono"
                        >
                          {copiedPass ? <CheckCheck className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          {copiedPass ? "Copied ✓" : "Copy"}
                        </button>
                      )}
                    </div>

                    {/* Warning Note */}
                    <div className="mt-3 p-3 rounded-xl bg-[#ffb547]/[0.06] border border-[#ffb547]/20 text-xs text-[#a39b8f] flex items-start gap-2.5">
                      <AlertCircle className="w-4 h-4 text-[#ffb547] flex-none mt-0.5" />
                      <span>
                        <b className="text-[#f4efe8]">There is no recovery.</b> If you lose this password the
                        contents cannot be decrypted. Store it somewhere safe.
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* Right Column: Sticky Live Preview */}
            <aside
              className="bg-gradient-to-b from-[#151311] to-[#100f0d] border border-white/[0.08] rounded-3xl p-5 md:p-6 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] lg:sticky lg:top-6 space-y-5"
              aria-label="Pouch live preview"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-xs font-semibold uppercase tracking-[0.16em] text-[#a39b8f]">
                  Live Preview
                </h3>
              </div>

              {/* Virtual Pouch Representation Card */}
              <div className="relative rounded-2xl p-5 border border-white/[0.14] overflow-hidden bg-[radial-gradient(260px_160px_at_100%_0%,rgba(109,93,252,0.28),transparent_70%),radial-gradient(260px_160px_at_0%_100%,rgba(255,93,143,0.22),transparent_70%),linear-gradient(160deg,#241f1a,#15120f)]">
                {/* Pinstripe overlay texture */}
                <div
                  className="absolute inset-0 pointer-events-none opacity-40"
                  style={{
                    backgroundImage:
                      "repeating-linear-gradient(115deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 9px)",
                  }}
                />

                <div className="relative flex justify-between items-start gap-3">
                  <div className="min-h-[34px]">
                    <h4
                      className={`font-serif text-2xl md:text-[28px] leading-tight break-words ${
                        pouchName.trim() ? "text-white" : "text-[#6f685e] italic"
                      }`}
                    >
                      {pouchName.trim() || "Untitled pouch"}
                    </h4>
                  </div>

                  <div
                    className={`w-10 h-10 rounded-xl grid place-items-center flex-none border transition-all ${
                      isEncrypted && password
                        ? "text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] border-transparent shadow-[0_6px_22px_rgba(255,93,143,0.35)]"
                        : "text-[#a39b8f] bg-black/40 border-white/[0.14]"
                    }`}
                    title={isEncrypted && password ? "Encrypted with AES-256-GCM" : "Unencrypted container"}
                  >
                    {isEncrypted && password ? <Lock className="w-5 h-5" /> : <Unlock className="w-5 h-5" />}
                  </div>
                </div>

                {/* 3 Stats Columns */}
                <div className="relative grid grid-cols-3 gap-2 mt-5">
                  <div className="bg-black/30 border border-white/[0.08] rounded-xl p-2.5 text-center">
                    <b className="block font-mono text-base font-semibold text-white tracking-tight">
                      {files.length}
                    </b>
                    <span className="font-mono text-[10px] text-[#6f685e] tracking-wider uppercase block mt-1">
                      Files
                    </span>
                  </div>
                  <div className="bg-black/30 border border-white/[0.08] rounded-xl p-2.5 text-center">
                    <b className="block font-mono text-base font-semibold text-white tracking-tight truncate">
                      {formatBytes(totalPayloadSize)}
                    </b>
                    <span className="font-mono text-[10px] text-[#6f685e] tracking-wider uppercase block mt-1">
                      Payload
                    </span>
                  </div>
                  <div className="bg-black/30 border border-white/[0.08] rounded-xl p-2.5 text-center">
                    <b className="block font-mono text-base font-semibold text-white tracking-tight truncate">
                      {isEncrypted && password ? "AES-256" : "Open"}
                    </b>
                    <span className="font-mono text-[10px] text-[#6f685e] tracking-wider uppercase block mt-1">
                      Security
                    </span>
                  </div>
                </div>

                {/* File categories breakdown bar */}
                <div className="relative mt-4">
                  {categoryBreakdown.length === 0 ? (
                    <div className="text-xs text-[#6f685e] italic pt-1">
                      Add files to inspect composition breakdown.
                    </div>
                  ) : (
                    <div>
                      <div className="flex h-2 rounded-full overflow-hidden bg-black/40">
                        {categoryBreakdown.map((cat) => (
                          <div
                            key={cat.key}
                            style={{ width: `${cat.percentage}%`, backgroundColor: cat.color }}
                            title={`${cat.label}: ${formatBytes(cat.bytes)} (${cat.percentage.toFixed(1)}%)`}
                            className="h-full transition-all duration-300"
                          />
                        ))}
                      </div>

                      <div className="flex flex-wrap gap-x-3.5 gap-y-1.5 mt-2.5 text-xs text-[#a39b8f]">
                        {categoryBreakdown.map((cat) => (
                          <span key={cat.key} className="inline-flex items-center gap-1.5 text-[11px]">
                            <span
                              className="w-2 h-2 rounded-sm inline-block"
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Requirement Checklist */}
              <ul className="space-y-2 text-xs text-[#a39b8f]">
                <li
                  className={`flex items-center gap-2.5 transition-colors ${
                    isNameValid ? "text-white" : "text-[#a39b8f]"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full grid place-items-center border transition-colors flex-none ${
                      isNameValid
                        ? "bg-[#4ade80] border-[#4ade80] text-[#06210f]"
                        : "border-white/[0.14] text-transparent"
                    }`}
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                  Name looks good (1-64 chars)
                </li>

                <li
                  className={`flex items-center gap-2.5 transition-colors ${
                    isFilesReady ? "text-white" : "text-[#a39b8f]"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full grid place-items-center border transition-colors flex-none ${
                      isFilesReady
                        ? "bg-[#4ade80] border-[#4ade80] text-[#06210f]"
                        : "border-white/[0.14] text-transparent"
                    }`}
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                  At least one file staged
                </li>

                <li
                  className={`flex items-center gap-2.5 transition-colors ${
                    isPasswordReady ? "text-white" : "text-[#a39b8f]"
                  }`}
                >
                  <span
                    className={`w-5 h-5 rounded-full grid place-items-center border transition-colors flex-none ${
                      isPasswordReady
                        ? "bg-[#4ade80] border-[#4ade80] text-[#06210f]"
                        : "border-white/[0.14] text-transparent"
                    }`}
                  >
                    <Check className="w-3 h-3 stroke-[3]" />
                  </span>
                  {!isEncrypted
                    ? "Password optional (unencrypted)"
                    : password.trim()
                    ? "Password configured"
                    : "Password required for encryption"}
                </li>
              </ul>

              {/* Primary Action Button */}
              <div className="pt-2">
                <button
                  type="button"
                  disabled={!canGenerate}
                  onClick={handleGeneratePouch}
                  className="w-full border-0 rounded-2xl py-4 px-5 font-bold text-[15.5px] text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] shadow-[0_14px_34px_-10px_rgba(255,93,143,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-105 active:scale-[0.99] disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-[#221e1a] disabled:text-[#6f685e] disabled:shadow-none transition-all flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-5 h-5" />
                  Generate pouch
                </button>
                <p className="text-[11.5px] text-[#6f685e] text-center mt-3">
                  Payloads above 300 MB switch to streaming mode and may need a local server to reopen.
                </p>
              </div>
            </aside>
          </div>
        )}

        {/* VIEW 2: BUSY PACKAGING MODE */}
        {viewMode === "busy" && (
          <div className="max-w-[720px] mx-auto py-12 md:py-16 text-center">
            <div className="bg-gradient-to-b from-[#151311] to-[#100f0d] border border-white/[0.08] rounded-3xl p-8 md:p-12 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)]">
              {/* Circular Progress Ring */}
              <div className="relative w-44 h-44 mx-auto mb-6">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120">
                  <defs>
                    <linearGradient id="ring-gradient" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#ffb547" />
                      <stop offset="55%" stopColor="#ff5d8f" />
                      <stop offset="100%" stopColor="#6d5dfc" />
                    </linearGradient>
                  </defs>
                  <circle cx="60" cy="60" r="52" fill="none" stroke="#221e1a" strokeWidth="8" />
                  <circle
                    cx="60"
                    cy="60"
                    r="52"
                    fill="none"
                    stroke="url(#ring-gradient)"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={CIRCLE_CIRCUMFERENCE}
                    strokeDashoffset={progressOffset}
                    className="transition-[stroke-dashoffset] duration-300 ease-out"
                  />
                </svg>

                {/* Percentage readout in center */}
                <div className="absolute inset-0 grid place-items-center font-mono font-semibold text-4xl text-white tracking-tighter">
                  <span>
                    {progress?.percentage || 0}
                    <small className="text-base text-[#a39b8f] font-normal">%</small>
                  </span>
                </div>
              </div>

              <h2 className="font-serif text-3xl text-white mb-1">Sealing your pouch…</h2>
              <p className="font-mono text-sm text-[#a39b8f] mb-6">
                {progress?.status || "Processing payload files"}
              </p>

              {/* Terminal-style build log */}
              <div
                ref={termRef}
                className="text-left bg-[#080706] border border-white/[0.08] rounded-2xl p-4 font-mono text-xs leading-relaxed text-[#b8afa2] min-h-[96px] max-h-52 overflow-y-auto space-y-1"
                aria-label="Build execution log"
              >
                {progress?.logs && progress.logs.length > 0 ? (
                  progress.logs.map((log, i) => (
                    <div key={i} className="flex gap-1.5">
                      <span className="text-[#ffb547]">›</span>
                      <span>{log}</span>
                    </div>
                  ))
                ) : (
                  <div className="text-[#6f685e]">Waiting for engine…</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW 3: DONE / RESULT MODE */}
        {viewMode === "done" && result && (
          <div className="py-6 md:py-10">
            {result.offlineNotice && (
              <div className="mb-6 p-4 rounded-2xl bg-[#fbbf24]/10 border border-[#fbbf24]/30 text-[#fde9b0] text-sm flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-[#fbbf24] flex-none mt-0.5" />
                <div>
                  <b className="block font-semibold">Built with online viewer fallback</b>
                  <span className="text-xs">
                    Viewer bundles were loaded via CDN. When opened offline, document viewers may need internet
                    access on first load.
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-6 items-stretch">
              {/* Left success badge card */}
              <div className="bg-gradient-to-b from-[#151311] to-[#100f0d] border border-white/[0.08] rounded-3xl p-8 flex flex-col items-center justify-center text-center shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] min-h-[300px]">
                <div className="w-24 h-24 rounded-[30px] grid place-items-center bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] text-[#1a1206] shadow-[0_18px_50px_-8px_rgba(255,93,143,0.55)] mb-5">
                  <Check className="w-12 h-12 stroke-[2.5]" />
                </div>
                <h2 className="font-serif text-3xl text-white mb-2">Pouch sealed</h2>
                <p className="text-sm text-[#a39b8f] max-w-xs leading-relaxed">
                  One standalone HTML file, completely self-contained and ready to share or archive.
                </p>
              </div>

              {/* Right details & action card */}
              <div className="bg-gradient-to-b from-[#151311] to-[#100f0d] border border-white/[0.08] rounded-3xl p-8 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.7)] flex flex-col justify-between">
                <div>
                  <h3 className="font-serif text-3xl text-white mb-3.5 break-words">{result.name}</h3>

                  {/* Metadata tags */}
                  <div className="flex flex-wrap gap-2 mb-6">
                    <span className="font-mono text-xs uppercase px-2.5 py-1.5 rounded-lg border border-white/[0.14] text-[#a39b8f]">
                      {formatBytes(result.size)}
                    </span>
                    <span className="font-mono text-xs uppercase px-2.5 py-1.5 rounded-lg border border-white/[0.14] text-[#a39b8f]">
                      {result.count} {result.count === 1 ? "file" : "files"}
                    </span>
                    {result.encrypted ? (
                      <span className="font-mono text-xs uppercase px-2.5 py-1.5 rounded-lg border border-[#ffb547]/40 bg-[#ffb547]/10 text-[#ffb547] flex items-center gap-1.5 font-semibold">
                        <Lock className="w-3.5 h-3.5" />
                        AES-256-GCM
                      </span>
                    ) : (
                      <span className="font-mono text-xs uppercase px-2.5 py-1.5 rounded-lg border border-white/[0.14] text-[#a39b8f]">
                        Unencrypted
                      </span>
                    )}
                    <span className="font-mono text-xs uppercase px-2.5 py-1.5 rounded-lg border border-[#4ade80]/40 bg-[#4ade80]/10 text-[#4ade80] flex items-center gap-1.5 font-semibold">
                      <Check className="w-3.5 h-3.5" />
                      Double-click ready
                    </span>
                  </div>

                  {/* Instructions */}
                  <ol className="space-y-3 mb-6 text-sm text-[#a39b8f]">
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full border border-white/[0.14] grid place-items-center font-mono text-xs font-semibold text-white flex-none">
                        1
                      </span>
                      <span>
                        <b className="text-white font-medium">Download</b> the .html file below.
                      </span>
                    </li>
                    <li className="flex items-center gap-3">
                      <span className="w-5 h-5 rounded-full border border-white/[0.14] grid place-items-center font-mono text-xs font-semibold text-white flex-none">
                        2
                      </span>
                      <span>
                        <b className="text-white font-medium">Double-click</b> it — it opens in any modern
                        browser, even fully offline.
                      </span>
                    </li>
                    {result.encrypted && (
                      <li className="flex items-center gap-3">
                        <span className="w-5 h-5 rounded-full border border-white/[0.14] grid place-items-center font-mono text-xs font-semibold text-white flex-none">
                          3
                        </span>
                        <span>
                          <b className="text-white font-medium">Enter your password</b> when prompted to unlock
                          the contents.
                        </span>
                      </li>
                    )}
                  </ol>
                </div>

                {/* Actions */}
                <div className="space-y-3">
                  <button
                    type="button"
                    onClick={handleDownloadPouch}
                    className="w-full border-0 rounded-2xl py-4 px-5 font-bold text-base text-[#1a1206] bg-gradient-to-r from-[#ffb547] via-[#ff5d8f] to-[#6d5dfc] shadow-[0_14px_34px_-10px_rgba(255,93,143,0.55),inset_0_1px_0_rgba(255,255,255,0.35)] hover:brightness-105 active:scale-[0.99] transition-all flex items-center justify-center gap-2"
                  >
                    <Download className="w-5 h-5" />
                    Download pouch (.html)
                  </button>

                  <div className="grid grid-cols-2 gap-3">
                    <button
                      type="button"
                      onClick={() => setViewMode("build")}
                      className="border border-white/[0.14] hover:bg-white/[0.05] rounded-xl py-3 px-4 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back to editing
                    </button>
                    <button
                      type="button"
                      onClick={handleStartNew}
                      className="border border-white/[0.14] hover:bg-white/[0.05] rounded-xl py-3 px-4 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Start a new pouch
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer with architecture facts */}
        <footer className="border-t border-white/[0.08] mt-10 pt-8 pb-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 text-xs text-[#6f685e] leading-relaxed">
            <div>
              <h4 className="font-semibold text-sm text-[#f4efe8] mb-2 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-[#ffb547]" />
                Authenticated encryption
              </h4>
              <p>
                AES-256-GCM with a PBKDF2-SHA-256 master key (600,000 iterations) and a unique random IV per
                file. Tampering with any byte fails authentication immediately.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm text-[#f4efe8] mb-2 flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ffb547]" />
                Self-opening container
              </h4>
              <p>
                Payloads up to 300 MB are embedded in base64 chunks directly in the HTML so a plain
                double-click works offline. Larger ones stream with HTTP range requests.
              </p>
            </div>
            <div>
              <h4 className="font-semibold text-sm text-[#f4efe8] mb-2 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-[#ffb547]" />
                Built-in viewers
              </h4>
              <p>
                Images with zoom and rotate, full-fidelity video with subtitles, persistent audio player with
                lyrics and EQ, lazy PDF reader, Markdown and syntax-highlighted code.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 text-xs font-mono text-[#6f685e]">
            <span>chromavault-pouch · HDA CCA protocol v2.1</span>
            <span>Files never leave your device</span>
          </div>
        </footer>
      </div>
    </div>
  );
};

export default App;
