import { z } from "zod";

/**
 * Validation schema for Pouch Creation
 */
export const PouchCreationSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Pouch name cannot be empty")
    .max(64, "Pouch name must not exceed 64 characters")
    .regex(/^[a-zA-Z0-9_\-\s.]+$/, "Pouch name contains invalid characters. Use letters, numbers, spaces, dots, dashes, or underscores."),
  password: z
    .string()
    .max(128, "Password must not exceed 128 characters")
    .nullable()
    .optional(),
  files: z
    .array(
      z.custom<File>((val) => typeof File !== "undefined" && val instanceof File, {
        message: "Item must be a valid File instance",
      })
    )
    .min(1, "At least one file must be selected for packing")
    .max(500, "Maximum 500 files can be packed into a single pouch"),
});

export type PouchCreationInput = z.infer<typeof PouchCreationSchema>;

/**
 * Escape string for safe insertion into HTML context (XSS prevention)
 */
export function escapeHtml(str: string): string {
  if (!str) return "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Sanitize filename to prevent directory traversal or control characters
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return "unnamed_file";
  // Remove control characters, path separators
  return filename
    .replace(/[\x00-\x1f\x80-\x9f]/g, "")
    .replace(/[/\\]/g, "_")
    .trim() || "unnamed_file";
}
