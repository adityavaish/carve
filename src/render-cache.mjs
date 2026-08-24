import { createHash } from 'node:crypto';

export function nativeRenderCacheKey({ documentUri, code, executable, files = [] }) {
  const hash = createHash('sha256');
  hash.update('carve-native-wrl-v1\0');
  hash.update(documentUri);
  hash.update('\0');
  hash.update(executable);
  hash.update('\0');
  hash.update(code);
  for (const file of [...files].sort((left, right) => left.name.localeCompare(right.name))) {
    hash.update('\0');
    hash.update(file.name);
    hash.update('\0');
    hash.update(file.data);
  }
  return hash.digest('hex');
}

export class NativeRenderCache {
  constructor({ maxEntries = 8, maxBytes = 64 * 1024 * 1024 } = {}) {
    this.maxEntries = maxEntries;
    this.maxBytes = maxBytes;
    this.entries = new Map();
    this.bytes = 0;
  }

  get(key) {
    const value = this.entries.get(key);
    if (!value) return undefined;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key, value) {
    const size = value.data?.byteLength ?? 0;
    if (size > this.maxBytes || this.maxEntries <= 0) return;
    const previous = this.entries.get(key);
    if (previous) {
      this.bytes -= previous.data?.byteLength ?? 0;
      this.entries.delete(key);
    }
    this.entries.set(key, value);
    this.bytes += size;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldestKey = this.entries.keys().next().value;
      const oldest = this.entries.get(oldestKey);
      this.bytes -= oldest?.data?.byteLength ?? 0;
      this.entries.delete(oldestKey);
    }
  }
}
