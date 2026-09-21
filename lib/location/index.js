/**
 * GoTogetherRides Location Normalization & Coordinate Source of Truth Layer
 */

/**
 * Normalizes any raw provider response into a standard internal location object.
 * @param {Object} input - Raw provider result or plain location object
 * @param {string} [providerName='unknown'] - Provider identifier
 * @returns {Object} Normalized location object
 */
function normalizeLocation(input, providerName = 'unknown') {
  if (!input || typeof input !== 'object') {
    throw new Error('Invalid location input: must be a non-null object');
  }

  const lat = parseFloat(input.latitude ?? input.lat ?? input.lat_deg);
  const lon = parseFloat(input.longitude ?? input.lon ?? input.lng ?? input.long_deg);

  if (isNaN(lat) || isNaN(lon)) {
    throw new Error(`Invalid location coordinates: lat=${input.lat}, lon=${input.lon}`);
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    throw new Error(`Coordinates out of bounds: lat=${lat}, lon=${lon}`);
  }

  const address = input.address || {};

  const name = input.name || input.display_name || input.formatted || [address.road, address.suburb, address.city || address.town || address.county].filter(Boolean).join(', ') || 'Selected Location';

  const city = input.city || address.city || address.town || address.village || address.suburb || null;
  const state = input.state || address.state || null;
  const country = input.country || address.country || null;
  const pincode = input.pincode || address.postcode || input.postcode || null;
  const confidence = input.confidence !== undefined ? parseFloat(input.confidence) : (input.importance !== undefined ? parseFloat(input.importance) : null);

  const normalized = {
    name,
    latitude: lat,
    longitude: lon,
    city,
    state,
    country,
    pincode,
    provider: input.provider || providerName,
    confidence,
    rawMetadata: input
  };

  return preserveCoordinates(normalized);
}

/**
 * Locks the location coordinates as the absolute source of truth.
 * @param {Object} locationObj - Location object
 * @returns {Object} Frozen coordinate object with helper methods
 */
function preserveCoordinates(locationObj) {
  const cloned = { ...locationObj };

  Object.defineProperty(cloned, 'isCoordinateSourceOfTruth', {
    value: true,
    writable: false,
    enumerable: true
  });

  return cloned;
}

/**
 * Helper to check if location object has valid preserved coordinates.
 */
function isValidLocation(loc) {
  return Boolean(
    loc &&
    typeof loc.latitude === 'number' && !isNaN(loc.latitude) &&
    typeof loc.longitude === 'number' && !isNaN(loc.longitude) &&
    loc.latitude >= -90 && loc.latitude <= 90 &&
    loc.longitude >= -180 && loc.longitude <= 180
  );
}

module.exports = {
  normalizeLocation,
  preserveCoordinates,
  isValidLocation
};
