/**
 * GoTogetherRides Cache Abstraction
 * Provides in-memory caching with TTL, LRU-style eviction, and safe key normalization.
 */

class SimpleCache {
  constructor(options = {}) {
    this.maxEntries = options.maxEntries || 1000;
    this.defaultTtlMs = options.defaultTtlMs || 5 * 60 * 1000; // 5 minutes default
    this.cache = new Map();
  }

  _generateKey(key) {
    if (typeof key === 'string') return key;
    return JSON.stringify(key);
  }

  get(key) {
    const k = this._generateKey(key);
    const item = this.cache.get(k);
    if (!item) return null;

    if (Date.now() > item.expiresAt) {
      this.cache.delete(k);
      return null;
    }

    return item.value;
  }

  set(key, value, ttlMs = this.defaultTtlMs) {
    const k = this._generateKey(key);
    
    // Evict oldest entry if max capacity reached
    if (this.cache.size >= this.maxEntries && !this.cache.has(k)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(k, {
      value,
      expiresAt: Date.now() + ttlMs
    });
  }

  has(key) {
    return this.get(key) !== null;
  }

  delete(key) {
    const k = this._generateKey(key);
    return this.cache.delete(k);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

module.exports = {
  SimpleCache,
  geocodingCache: new SimpleCache({ maxEntries: 500, defaultTtlMs: 15 * 60 * 1000 }), // 15 mins
  routingCache: new SimpleCache({ maxEntries: 500, defaultTtlMs: 10 * 60 * 1000 })   // 10 mins
};
