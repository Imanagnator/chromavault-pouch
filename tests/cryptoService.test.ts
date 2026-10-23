import { describe, it, expect } from 'vitest';
import { deriveKey, encryptData, decryptData, computeSha256 } from '../services/cryptoService';
import { escapeHtml, sanitizeFilename, PouchCreationSchema } from '../lib/validation';

describe('CryptoService', () => {
  it('computes consistent SHA-256 hashes', async () => {
    const hash = await computeSha256('test-password-123');
    expect(hash).toHaveLength(64);
    expect(typeof hash).toBe('string');
    
    // Hash consistency
    const hash2 = await computeSha256('test-password-123');
    expect(hash).toBe(hash2);

    // Differentiation
    const hashDiff = await computeSha256('different-password');
    expect(hash).not.toBe(hashDiff);
  });

  it('encrypts and decrypts binary payloads cleanly with AES-256-GCM', async () => {
    const password = 'SuperSecurePouchPassword!2026';
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);

    const key = await deriveKey(password, salt, 1000); // 1000 iterations for test execution speed
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const originalText = 'Hello ChromaVault Cellular Architecture!';
    const encoded = new TextEncoder().encode(originalText);
    const originalBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;

    const ciphertext = await encryptData(originalBuffer, key, iv);
    expect(ciphertext.byteLength).toBeGreaterThan(originalBuffer.byteLength);

    const decryptedBuffer = await decryptData(ciphertext, key, iv);
    const decryptedText = new TextDecoder().decode(decryptedBuffer);

    expect(decryptedText).toBe(originalText);
  });

  it('fails decryption with wrong key or tampered data', async () => {
    const salt = new Uint8Array(16);
    globalThis.crypto.getRandomValues(salt);

    const key1 = await deriveKey('correct-pass', salt, 1000);
    const key2 = await deriveKey('wrong-pass', salt, 1000);
    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const encoded = new TextEncoder().encode('Confidential payload');
    const originalBuffer = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength) as ArrayBuffer;
    const ciphertext = await encryptData(originalBuffer, key1, iv);

    await expect(decryptData(ciphertext, key2, iv)).rejects.toThrow();
  });
});

describe('Validation and Sanitization', () => {
  it('escapes dangerous HTML characters to prevent XSS injection', () => {
    const dangerousInput = '<script>alert("xss")</script>&<img src=x onerror=steal()>';
    const escaped = escapeHtml(dangerousInput);

    expect(escaped).not.toContain('<script>');
    expect(escaped).not.toContain('<img');
    expect(escaped).toContain('&lt;script&gt;');
    expect(escaped).toContain('&lt;img');
    expect(escaped).toContain('&amp;');
  });

  it('sanitizes filenames safely', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe(".._.._etc_passwd");
    expect(sanitizeFilename('normal-file_1.png')).toBe('normal-file_1.png');
    expect(sanitizeFilename('')).toBe('unnamed_file');
  });

  it('validates pouch creation parameters with schema', () => {
    const mockFile = new File(['dummy content'], 'dummy.txt', { type: 'text/plain' });
    const valid = PouchCreationSchema.safeParse({
      name: 'Safe_Pouch_Name-1',
      password: 'mypassword',
      files: [mockFile]
    });
    expect(valid.success).toBe(true);

    const invalidName = PouchCreationSchema.safeParse({
      name: '<script>invalid</script>',
      password: null,
      files: [mockFile]
    });
    expect(invalidName.success).toBe(false);
  });
});
