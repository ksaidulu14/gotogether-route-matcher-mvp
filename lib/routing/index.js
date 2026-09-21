/**
 * GoTogetherRides Provider-Independent Routing Abstraction
 */

const OSRMProvider = require('./osrm');
const { routingCache } = require('../cache');

class RoutingService {
  constructor(options = {}) {
    const providerName = options.provider || process.env.ROUTING_PROVIDER || 'osrm';

    if (providerName === 'osrm') {
      this.provider = new OSRMProvider(options);
    } else if (options.customProvider) {
      this.provider = options.customProvider;
    } else {
      this.provider = new OSRMProvider(options);
    }

    this.useCache = options.useCache !== false;
  }

  async route(origin, destination, options = {}) {
    const origLat = Number(origin.latitude ?? origin.lat).toFixed(5);
    const origLon = Number(origin.longitude ?? origin.lon ?? origin.lng).toFixed(5);
    const destLat = Number(destination.latitude ?? destination.lat).toFixed(5);
    const destLon = Number(destination.longitude ?? destination.lon ?? destination.lng).toFixed(5);

    const cacheKey = `route:${origLat},${origLon}->${destLat},${destLon}:${options.profile || 'driving'}`;

    if (this.useCache) {
      const cached = routingCache.get(cacheKey);
      if (cached) {
        return cached;
      }
    }

    try {
      const result = await this.provider.route(origin, destination, options);
      if (this.useCache && result && result.geometry && result.geometry.length > 0) {
        routingCache.set(cacheKey, result);
      }
      return result;
    } catch (err) {
      console.error('[RoutingService] Route query failed:', err.message);

      // Fallback: If OSRM fails or offline, return straight line fallback geometry flagged appropriately
      const fallbackGeometry = [
        [Number(origLat), Number(origLon)],
        [Number(destLat), Number(destLon)]
      ];
      
      const fallback = {
        geometry: fallbackGeometry,
        distanceMeters: Math.round(this._haversineDistance(origin, destination) * 1000),
        durationSeconds: Math.round(this._haversineDistance(origin, destination) * 120), // approx 30km/h
        provider: 'fallback-straight-line',
        error: err.message
      };

      return fallback;
    }
  }

  _haversineDistance(pt1, pt2) {
    const R = 6371; // km
    const lat1 = (pt1.latitude ?? pt1.lat) * Math.PI / 180;
    const lat2 = (pt2.latitude ?? pt2.lat) * Math.PI / 180;
    const dLat = ((pt2.latitude ?? pt2.lat) - (pt1.latitude ?? pt1.lat)) * Math.PI / 180;
    const dLon = ((pt2.longitude ?? pt2.lon ?? pt2.lng) - (pt1.longitude ?? pt1.lon ?? pt1.lng)) * Math.PI / 180;

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new RoutingService();
module.exports.RoutingService = RoutingService;
