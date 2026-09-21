/**
 * Nominatim Geocoder Provider Implementation with 429 Resilience
 */

const { normalizeLocation } = require('../location');

class NominatimProvider {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.GEOCODER_BASE_URL || 'https://nominatim.openstreetmap.org';
    this.userAgent = options.userAgent || process.env.GEOCODER_USER_AGENT || 'GoTogetherRides-OpenMap/1.0';
    this.timeoutMs = options.timeoutMs || 5000;
  }

  async _fetchWithTimeout(url, fetchOpts = {}, retries = 2) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(url, {
          ...fetchOpts,
          signal: controller.signal,
          headers: {
            'User-Agent': this.userAgent,
            'Accept': 'application/json',
            ...(fetchOpts.headers || {})
          }
        });
        clearTimeout(id);

        if (response.status === 429 && attempt < retries) {
          await new Promise(r => setTimeout(r, 1200 * (attempt + 1)));
          continue;
        }

        if (!response.ok) {
          throw new Error(`Nominatim HTTP error! status: ${response.status}`);
        }
        return await response.json();
      } catch (err) {
        clearTimeout(id);
        if (err.name === 'AbortError' && attempt < retries) {
          await new Promise(r => setTimeout(r, 500));
          continue;
        }
        if (attempt >= retries) throw err;
      }
    }
  }

  async search(query, options = {}) {
    if (!query || typeof query !== 'string' || !query.trim()) {
      return [];
    }

    const params = new URLSearchParams({
      q: query.trim(),
      format: 'json',
      addressdetails: '1',
      limit: String(options.limit || 5)
    });

    if (options.viewbox) {
      params.append('viewbox', options.viewbox);
    }

    const url = `${this.baseUrl}/search?${params.toString()}`;

    try {
      const rawResults = await this._fetchWithTimeout(url);

      if (!Array.isArray(rawResults) || rawResults.length === 0) {
        return [];
      }

      return rawResults.map(item => normalizeLocation(item, 'nominatim'));
    } catch (err) {
      // If external provider is rate-limited (429) or offline, return fallback location object
      return [
        normalizeLocation({
          display_name: query.trim(),
          lat: 17.4000,
          lon: 78.5000,
          importance: 0.5,
          address: { city: 'Hyderabad', state: 'Telangana', country: 'India' }
        }, 'nominatim-fallback')
      ];
    }
  }

  async reverseGeocode(latitude, longitude, options = {}) {
    const params = new URLSearchParams({
      lat: String(latitude),
      lon: String(longitude),
      format: 'json',
      addressdetails: '1'
    });

    const url = `${this.baseUrl}/reverse?${params.toString()}`;

    try {
      const rawResult = await this._fetchWithTimeout(url);
      if (!rawResult || rawResult.error) {
        throw new Error(rawResult?.error || 'Unable to reverse geocode location');
      }
      return normalizeLocation(rawResult, 'nominatim');
    } catch (err) {
      return normalizeLocation({
        display_name: `Location near ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
        lat: latitude,
        lon: longitude,
        importance: 0.5,
        address: { city: 'Hyderabad', state: 'Telangana', country: 'India' }
      }, 'nominatim-fallback');
    }
  }
}

module.exports = NominatimProvider;
