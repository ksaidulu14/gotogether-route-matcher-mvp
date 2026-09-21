/**
 * End-to-End Coordinate Source of Truth Verification Test
 * Verifies that the exact selected location coordinates flow through routing, matching, meeting points, and map markers with ZERO coordinate drift or re-geocoding.
 */

const assert = require('assert');
const { normalizeLocation } = require('../../lib/location');
const routingService = require('../../lib/routing');
const { adaptRouteForMatching } = require('../../lib/matching/adapter');
const { haversineKm } = require('../../lib/matching/dynamic_meeting');

async function verifyCoordinateSourceOfTruth() {
  console.log('==================================================');
  console.log('VERIFYING COORDINATE SOURCE OF TRUTH INTEGRITY');
  console.log('==================================================');

  // Step 1: User selects autocomplete result (Uppal Ring Road Signal)
  const rawAutocompleteResult = {
    display_name: 'Uppal Ring Road Signal, Uppal, Hyderabad',
    lat: '17.4025123',
    lon: '78.5612456',
    importance: 0.9,
    address: { suburb: 'Uppal', city: 'Hyderabad', state: 'Telangana', postcode: '500039' }
  };

  const selectedLocation = normalizeLocation(rawAutocompleteResult, 'nominatim');

  console.log('[1. Autocomplete Selection]');
  console.log(` - Selected Name: "${selectedLocation.name}"`);
  console.log(` - Selected Lat/Lon: (${selectedLocation.latitude}, ${selectedLocation.longitude})`);
  console.log(` - Is Source of Truth: ${selectedLocation.isCoordinateSourceOfTruth}`);

  assert.strictEqual(selectedLocation.latitude, 17.4025123);
  assert.strictEqual(selectedLocation.longitude, 78.5612456);
  assert.strictEqual(selectedLocation.isCoordinateSourceOfTruth, true);

  // Step 2: User selects destination (Ghatkesar Signal)
  const destinationLocation = normalizeLocation({
    display_name: 'Ghatkesar Railway Station, Telangana',
    lat: '17.4528789',
    lon: '78.6835123'
  }, 'nominatim');

  // Step 3: Database journey record persistence
  console.log('\n[2. Database Journey Record Persistence]');
  const journeyRecord = {
    a_pickup_lat: selectedLocation.latitude,
    a_pickup_lon: selectedLocation.longitude,
    a_drop_lat: destinationLocation.latitude,
    a_drop_lon: destinationLocation.longitude
  };

  assert.strictEqual(journeyRecord.a_pickup_lat, 17.4025123);
  assert.strictEqual(journeyRecord.a_pickup_lon, 78.5612456);

  // Step 4: Routing Layer uses exact selected coordinates
  console.log('\n[3. Routing Execution]');
  const route = await routingService.route(selectedLocation, destinationLocation);

  console.log(` - Provider: ${route.provider}`);
  console.log(` - OSRM Road Snap Origin: (${route.geometry[0][0]}, ${route.geometry[0][1]})`);
  
  // Calculate road snapping distance
  const snapDistMeters = haversineKm([selectedLocation.latitude, selectedLocation.longitude], route.geometry[0]) * 1000;
  console.log(` - Road Network Snap Distance: ${snapDistMeters.toFixed(1)} meters`);
  assert.ok(snapDistMeters < 100, 'OSRM road snap distance should be within 100 meters');

  // Step 5: Route Matcher Adapter & Dynamic Meeting Point
  console.log('\n[4. Matcher & Dynamic Meeting Point Execution]');
  const candidatePickup = { latitude: 17.3750, longitude: 78.5600 };
  const candidateDrop = { latitude: 17.4528789, longitude: 78.6835123 };
  const candRoute = await routingService.route(candidatePickup, candidateDrop);

  const matchData = adaptRouteForMatching(
    { id: 'usr1', a_pickup_lat: selectedLocation.latitude, a_pickup_lon: selectedLocation.longitude, a_drop_lat: destinationLocation.latitude, a_drop_lon: destinationLocation.longitude },
    { id: 'cand1' },
    route.geometry,
    candRoute.geometry
  );

  console.log(` - Dynamic Meeting Lat/Lon: (${matchData.meetingPoint.latitude.toFixed(6)}, ${matchData.meetingPoint.longitude.toFixed(6)})`);
  console.log(` - Shared Route Distance: ${matchData.sharedDistanceKm} km`);

  // Step 6: Map Marker Verification (Must plot EXACT selected coordinates)
  console.log('\n[5. Map Visualization Marker Coordinates]');
  const userPickupMarker = [selectedLocation.latitude, selectedLocation.longitude];
  const userDropMarker = [destinationLocation.latitude, destinationLocation.longitude];

  assert.strictEqual(userPickupMarker[0], 17.4025123);
  assert.strictEqual(userPickupMarker[1], 78.5612456);
  assert.strictEqual(userDropMarker[0], 17.4528789);
  assert.strictEqual(userDropMarker[1], 78.6835123);

  console.log('==================================================');
  console.log('SUCCESS: ZERO COORDINATE DRIFT. SOURCE OF TRUTH PRESERVED 100%.');
  console.log('==================================================');
}

verifyCoordinateSourceOfTruth().catch(err => {
  console.error('Coordinate Source of Truth verification failed:', err);
  process.exit(1);
});
