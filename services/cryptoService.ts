/**
 * ChromaVault Cryptographic Service
 * Uses Web Crypto API (globalThis.crypto) for high-performance, secure AES-256-GCM data transformation.
 * Compliant with NIST SP 800-38D and PBKDF2 standards.
 */

export const PBKDF2_ITERATIONS = 600000;

const getSubtleCrypto = (): SubtleCrypto => {
  const c = typeof window !== 'undefined' ? window.crypto : globalThis.crypto;
  if (!c || !c.subtle) {
    throw new Error('Web Crypto API (subtle) is not available in the current environment.');
  }
  return c.subtle;
};

/**
 * Derives a 256-bit AES-GCM CryptoKey from a password and salt using PBKDF2.
 */
export const deriveKey = async (
  password: string,
  salt: Uint8Array,
  iterations: number = PBKDF2_ITERATIONS
): Promise<CryptoKey> => {
  const subtle = getSubtleCrypto();
  const enc = new TextEncoder();
  const keyMaterial = await subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  return subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
};

/**
 * Encrypts an ArrayBuffer payload with AES-GCM using the provided key and IV.
 */
export const encryptData = async (
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> => {
  const subtle = getSubtleCrypto();
  return subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
};

/**
 * Decrypts an ArrayBuffer ciphertext with AES-GCM using the provided key and IV.
 */
export const decryptData = async (
  data: ArrayBuffer,
  key: CryptoKey,
  iv: Uint8Array
): Promise<ArrayBuffer> => {
  const subtle = getSubtleCrypto();
  return subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );
};

/**
 * Computes a hex-encoded SHA-256 hash of a string or buffer.
 */
export const computeSha256 = async (
  input: string | Uint8Array | ArrayBuffer
): Promise<string> => {
  const subtle = getSubtleCrypto();
  let buffer: Uint8Array;
  if (typeof input === 'string') {
    buffer = new TextEncoder().encode(input);
  } else if (input instanceof Uint8Array) {
    buffer = input;
  } else {
    buffer = new Uint8Array(input);
  }

  const hashBuffer = await subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};
