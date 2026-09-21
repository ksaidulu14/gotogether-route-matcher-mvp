/**
 * OSRM Routing Provider Implementation
 */

class OSRMProvider {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.OSRM_BASE_URL || 'https://router.project-osrm.org';
    this.profile = options.profile || 'driving';
    this.timeoutMs = options.timeoutMs || 8000;
  }

  async _fetchWithTimeout(url) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);

      if (!response.ok) {
        throw new Error(`OSRM HTTP error! status: ${response.status}`);
      }
      return await response.json();
    } catch (err) {
      clearTimeout(id);
      if (err.name === 'AbortError') {
        throw new Error(`OSRM routing request timed out after ${this.timeoutMs}ms`);
      }
      throw err;
    }
  }

  async route(origin, destination, options = {}) {
    const origLat = origin.latitude ?? origin.lat;
    const origLon = origin.longitude ?? origin.lon ?? origin.lng;
    const destLat = destination.latitude ?? destination.lat;
    const destLon = destination.longitude ?? destination.lon ?? destination.lng;

    if (origLat == null || origLon == null || destLat == null || destLon == null) {
      throw new Error('OSRM route requires valid origin and destination coordinates');
    }

    // OSRM expects coordinates in lon,lat order
    const coordsStr = `${origLon},${origLat};${destLon},${destLat}`;
    const overview = options.overview || 'full';
    const geometries = options.geometries || 'geojson';

    const url = `${this.baseUrl}/route/v1/${this.profile}/${coordsStr}?overview=${overview}&geometries=${geometries}`;
    const data = await this._fetchWithTimeout(url);

    if (!data || data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      throw new Error(`OSRM Routing failed: ${data?.message || 'No route found'}`);
    }

    const primaryRoute = data.routes[0];

    // Convert GeoJSON coordinates [lon, lat] -> internal [lat, lon]
    let geometry = [];
    if (primaryRoute.geometry && Array.isArray(primaryRoute.geometry.coordinates)) {
      geometry = primaryRoute.geometry.coordinates.map(coord => [coord[1], coord[0]]);
    }

    return {
      geometry,
      distanceMeters: Math.round(primaryRoute.distance || 0),
      durationSeconds: Math.round(primaryRoute.duration || 0),
      provider: 'osrm'
    };
  }
}

module.exports = OSRMProvider;
