import { describe, it, expect } from "vitest";
import {
  formatBytes,
  getFileCategory,
  getExtBadge,
  calculatePasswordStrength,
  generateStrongPassword,
} from "../lib/utils";

describe("UI & Utility Helpers", () => {
  describe("formatBytes", () => {
    it("formats byte values cleanly with appropriate units", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(512)).toBe("512 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1536)).toBe("1.5 KB");
      expect(formatBytes(1048576)).toBe("1 MB");
      expect(formatBytes(1073741824)).toBe("1 GB");
    });
  });

  describe("getFileCategory & getExtBadge", () => {
    it("correctly identifies image, video, audio, pdf, code and documents", () => {
      expect(getFileCategory({ name: "picture.png" })).toBe("image");
      expect(getFileCategory({ name: "movie.mp4" })).toBe("video");
      expect(getFileCategory({ name: "song.flac" })).toBe("audio");
      expect(getFileCategory({ name: "handbook.pdf" })).toBe("pdf");
      expect(getFileCategory({ name: "script.ts" })).toBe("code");
      expect(getFileCategory({ name: "archive.zip" })).toBe("archive");
      expect(getFileCategory({ name: "notes.md" })).toBe("doc");
      expect(getFileCategory({ name: "unknown.xyz" })).toBe("other");
    });

    it("falls back to MIME types if extensions are ambiguous", () => {
      expect(getFileCategory({ name: "raw_asset", type: "image/webp" })).toBe("image");
      expect(getFileCategory({ name: "stream_data", type: "audio/ogg" })).toBe("audio");
    });

    it("extracts concise 3-4 letter uppercase badges", () => {
      expect(getExtBadge("photo.jpeg")).toBe("JPEG");
      expect(getExtBadge("index.html")).toBe("HTML");
      expect(getExtBadge("noext")).toBe("FILE");
    });
  });

  describe("calculatePasswordStrength & generateStrongPassword", () => {
    it("grades password strength across 4 tiers", () => {
      expect(calculatePasswordStrength("").score).toBe(0);
      expect(calculatePasswordStrength("abc").score).toBe(1); // Weak
      expect(calculatePasswordStrength("Abc12345").score).toBeGreaterThanOrEqual(2); // Fair
      expect(calculatePasswordStrength("SuperP@ssw0rd!2026").score).toBe(4); // Strong
    });

    it("penalizes trivial or repeated passwords", () => {
      expect(calculatePasswordStrength("aaaaaaaaaaaa").score).toBe(1);
      expect(calculatePasswordStrength("password123").score).toBe(1);
    });

    it("generates high-entropy cryptographic passwords with specified length", () => {
      const pwd = generateStrongPassword(24);
      expect(pwd).toHaveLength(24);
      expect(calculatePasswordStrength(pwd).score).toBe(4);
      const pwd2 = generateStrongPassword(24);
      expect(pwd).not.toBe(pwd2);
    });
  });
});
