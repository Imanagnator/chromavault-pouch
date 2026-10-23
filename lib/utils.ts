import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number, decimals = 1): string {
  if (!+bytes) return '0 B';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];

  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
  const value = bytes / Math.pow(k, i);

  return `${i === 0 ? value : value.toFixed(dm).replace(/\.0$/, '')} ${sizes[i]}`;
}

export interface FileCategoryInfo {
  label: string;
  color: string;
  extensions: string[];
}

export const FILE_CATEGORIES: Record<string, FileCategoryInfo> = {
  image: {
    label: "Images",
    color: "#3fd0c9",
    extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico", "heic", "tif", "tiff"],
  },
  video: {
    label: "Video",
    color: "#ff5d8f",
    extensions: ["mp4", "mkv", "mov", "webm", "avi", "m4v", "wmv", "flv"],
  },
  audio: {
    label: "Audio",
    color: "#a78bfa",
    extensions: ["mp3", "wav", "flac", "ogg", "m4a", "aac", "opus", "wma"],
  },
  pdf: {
    label: "PDF",
    color: "#ff7a59",
    extensions: ["pdf"],
  },
  doc: {
    label: "Docs",
    color: "#ffb547",
    extensions: ["doc", "docx", "txt", "md", "rtf", "odt", "xls", "xlsx", "csv", "ppt", "pptx", "json", "xml", "yml", "yaml", "epub"],
  },
  code: {
    label: "Code",
    color: "#6ee7a8",
    extensions: ["js", "ts", "jsx", "tsx", "html", "css", "py", "java", "c", "cpp", "h", "rs", "go", "rb", "php", "sh", "sql", "swift", "kt"],
  },
  archive: {
    label: "Archives",
    color: "#c4b5a0",
    extensions: ["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "apk", "exe", "dmg"],
  },
  other: {
    label: "Other",
    color: "#8a8378",
    extensions: [],
  },
};

export function getFileCategory(file: { name: string; type?: string }): keyof typeof FILE_CATEGORIES {
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  for (const [key, cat] of Object.entries(FILE_CATEGORIES)) {
    if (cat.extensions.includes(ext)) return key as keyof typeof FILE_CATEGORIES;
  }
  if (file.type?.startsWith("image/")) return "image";
  if (file.type?.startsWith("video/")) return "video";
  if (file.type?.startsWith("audio/")) return "audio";
  if (file.type === "application/pdf") return "pdf";
  return "other";
}

export function getExtBadge(name: string): string {
  const parts = name.split(".");
  return parts.length > 1 ? (parts.pop()?.slice(0, 4).toUpperCase() || "FILE") : "FILE";
}

export interface PasswordStrengthResult {
  score: number; // 0 to 4
  label: string;
  colorClass: string;
  barColor: string;
}

export function calculatePasswordStrength(pass: string): PasswordStrengthResult {
  if (!pass) return { score: 0, label: "Enter a password", colorClass: "text-zinc-500", barColor: "bg-zinc-800" };
  let score = 0;
  if (pass.length >= 8) score++;
  if (pass.length >= 12) score++;
  if (/[a-z]/.test(pass) && /[A-Z]/.test(pass)) score++;
  if (/\d/.test(pass)) score++;
  if (/[^A-Za-z0-9]/.test(pass)) score++;
  if (pass.length >= 16) score++;
  if (/^(.)\1+$/.test(pass) || /^(password|12345678|qwerty)/i.test(pass)) {
    score = Math.min(score, 1);
  }
  const tier = score <= 2 ? 1 : score === 3 ? 2 : score === 4 ? 3 : 4;
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  const colorClasses = ["", "text-[#ff6b6b]", "text-[#fbbf24]", "text-[#a3e635]", "text-[#4ade80]"];
  const barColors = ["", "#ff6b6b", "#fbbf24", "#a3e635", "#4ade80"];
  return { score: tier, label: labels[tier], colorClass: colorClasses[tier], barColor: barColors[tier] };
}

export function generateStrongPassword(len = 20): string {
  const charset = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*-_+=?";
  const buf = new Uint32Array(len);
  const limit = Math.floor(4294967296 / charset.length) * charset.length;
  let out = "";
  while (out.length < len) {
    (typeof window !== "undefined" ? window.crypto : globalThis.crypto).getRandomValues(buf);
    for (const v of buf) {
      if (v < limit && out.length < len) {
        out += charset[v % charset.length];
      }
    }
  }
  return out;
}

