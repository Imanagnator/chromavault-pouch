import { describe, it, expect } from 'vitest';

class LRUBlobCache {
  maxBytes: number;
  used: number;
  map: Map<number | string, { size: number; blob: Blob }>;

  constructor(maxBytes: number) {
    this.maxBytes = maxBytes;
    this.used = 0;
    this.map = new Map();
  }

  get(id: number | string): Blob | null {
    if (!this.map.has(id)) return null;
    const entry = this.map.get(id)!;
    this.map.delete(id);
    this.map.set(id, entry);
    return entry.blob;
  }

  set(id: number | string, blob: Blob): void {
    if (this.map.has(id)) return;
    this.map.set(id, { size: blob.size, blob });
    this.used += blob.size;

    for (const [k, entry] of this.map) {
      if (this.used <= this.maxBytes) break;
      this.map.delete(k);
      this.used -= entry.size;
    }
  }

  clear(): void {
    this.map.clear();
    this.used = 0;
  }
}

describe('LRUBlobCache', () => {
  it('stores and retrieves items correctly', () => {
    const cache = new LRUBlobCache(1000);
    const blob1 = new Blob(['hello world'], { type: 'text/plain' });
    cache.set(1, blob1);

    expect(cache.get(1)).toBe(blob1);
    expect(cache.get(2)).toBeNull();
  });

  it('evicts least recently used items when exceeding maxBytes', () => {
    // 30 bytes budget
    const cache = new LRUBlobCache(30);

    const blob1 = new Blob([new Uint8Array(10)]);
    const blob2 = new Blob([new Uint8Array(15)]);
    const blob3 = new Blob([new Uint8Array(15)]);

    cache.set('a', blob1); // used: 10
    cache.set('b', blob2); // used: 25
    expect(cache.used).toBe(25);

    // Refresh 'a' by getting it so 'b' becomes the oldest
    cache.get('a');

    // Adding blob3 (15 bytes) pushes used to 40 > 30.
    // 'b' is evicted!
    cache.set('c', blob3);

    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.used).toBeLessThanOrEqual(30);
  });
});
