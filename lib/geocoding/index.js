/**
 * GoTogetherRides Provider-Independent Geocoder Abstraction
 * Enriched with Location Search Intelligence (Query Normalization, Generic Fuzzy Expansion, Multi-Signal Ranking)
 */

const NominatimProvider = require('./nominatim');
const { geocodingCache } = require('../cache');
const {
  normalizeQuery,
  generateGenericVariants,
  rankCandidates
} = require('./search_intelligence');

class GeocoderService {
  constructor(options = {}) {
    const providerName = options.provider || process.env.GEOCODER_PROVIDER || 'nominatim';

    if (providerName === 'nominatim') {
      this.provider = new NominatimProvider(options);
    } else if (options.customProvider) {
      this.provider = options.customProvider;
    } else {
      this.provider = new NominatimProvider(options);
    }

    this.useCache = options.useCache !== false;
  }

  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const normalized = normalizeQuery(query);
    if (!normalized) return [];

    const cacheKey = `search:${normalized}:${options.limit || 5}:${options.viewbox || ''}`;

    if (this.useCache) {
      const cached = geocodingCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      // Step 1: Query primary normalized query
      let candidates = await this.provider.search(normalized, options);

      // Step 2: ONLY if primary query returns 0 results AND query is not a numeric PIN code, try generic fuzzy variants
      const isNumeric = /^\d+$/.test(normalized);

      if ((!candidates || candidates.length === 0) && !isNumeric) {
        const variants = generateGenericVariants(query);
        const candidatePool = [];

        for (const variant of variants) {
          if (variant === normalized) continue;
          try {
            const varResults = await this.provider.search(variant, options);
            if (varResults && varResults.length > 0) {
              candidatePool.push(...varResults);
              break; // Stop after finding first working variant
            }
          } catch (e) {
            // Ignore individual variant fetch errors
          }
        }

        candidates = candidatePool;
      }

      // Step 3: Multi-signal candidate ranking
      const rankedResults = rankCandidates(query, candidates, options);
      const finalResults = rankedResults.slice(0, options.limit || 5);

      if (this.useCache && finalResults.length > 0) {
        geocodingCache.set(cacheKey, finalResults);
      }

      return finalResults;
    } catch (err) {
      console.error('[GeocoderService] Search failed:', err.message);
      return [];
    }
  }

  async reverseGeocode(latitude, longitude, options = {}) {
    const roundedLat = Number(latitude).toFixed(5);
    const roundedLon = Number(longitude).toFixed(5);
    const cacheKey = `reverse:${roundedLat}:${roundedLon}`;

    if (this.useCache) {
      const cached = geocodingCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await this.provider.reverseGeocode(latitude, longitude, options);
      if (this.useCache && result) {
        geocodingCache.set(cacheKey, result);
      }
      return result;
    } catch (err) {
      console.error('[GeocoderService] Reverse geocode failed:', err.message);
      return null;
    }
  }

  createDebounceHelper(fn, delayMs = 300) {
    let timer = null;
    return (...args) => {
      return new Promise((resolve, reject) => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(async () => {
          try {
            const res = await fn(...args);
            resolve(res);
          } catch (e) {
            reject(e);
          }
        }, delayMs);
      });
    };
  }
}

module.exports = new GeocoderService();
module.exports.GeocoderService = GeocoderService;
module.exports.searchIntelligence = searchIntelligence;
