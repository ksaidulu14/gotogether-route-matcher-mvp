/**
 * Automated Test Suite - GoTogether Open Map Infrastructure
 */

const assert = require('assert');
const { normalizeLocation, preserveCoordinates, isValidLocation } = require('../../lib/location');
const geocoderService = require('../../lib/geocoding');
const routingService = require('../../lib/routing');
const { geocodingCache, routingCache } = require('../../lib/cache');
const { computeDynamicMeetingData, findClosestPointOnPolyline } = require('../../lib/matching/dynamic_meeting');
const { adaptRouteForMatching } = require('../../lib/matching/adapter');

async function runTests() {
  console.log('==================================================');
  console.log('RUNNING OPEN MAP INFRASTRUCTURE TEST SUITE');
  console.log('==================================================');

  let passed = 0;
  let total = 0;

  function test(description, fn) {
    total++;
    try {
      fn();
      console.log(`[PASS] #${total}: ${description}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] #${total}: ${description}`);
      console.error(err);
    }
  }

  async function asyncTest(description, fn) {
    total++;
    try {
      await fn();
      console.log(`[PASS] #${total}: ${description}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] #${total}: ${description}`);
      console.error(err);
    }
  }

  // 1. Provider Response Normalization
  test('1. Provider response normalization format', () => {
    const rawNominatim = {
      display_name: 'Uppal, Hyderabad, Telangana, India',
      lat: '17.3984',
      lon: '78.5583',
      importance: 0.85,
      address: { city: 'Hyderabad', state: 'Telangana', country: 'India', postcode: '500039' }
    };
    const norm = normalizeLocation(rawNominatim, 'nominatim');

    assert.strictEqual(norm.name, 'Uppal, Hyderabad, Telangana, India');
    assert.strictEqual(norm.latitude, 17.3984);
    assert.strictEqual(norm.longitude, 78.5583);
    assert.strictEqual(norm.city, 'Hyderabad');
    assert.strictEqual(norm.state, 'Telangana');
    assert.strictEqual(norm.country, 'India');
    assert.strictEqual(norm.pincode, '500039');
    assert.strictEqual(norm.provider, 'nominatim');
    assert.strictEqual(norm.confidence, 0.85);
  });

  // 2. Coordinate Preservation (Source of Truth)
  test('2. Coordinate preservation as Source of Truth', () => {
    const loc = normalizeLocation({ name: 'Test Place', lat: 17.40, lon: 78.50 });
    const preserved = preserveCoordinates(loc);

    assert.strictEqual(preserved.isCoordinateSourceOfTruth, true);
    assert.strictEqual(preserved.latitude, 17.40);
    assert.strictEqual(preserved.longitude, 78.50);
  });

  // 3. Geocoder Caching & TTL
  test('3. Geocoder caching mechanism', () => {
    geocodingCache.clear();
    const testKey = 'search:uppal:5:';
    assert.strictEqual(geocodingCache.get(testKey), null);

    const dummyResults = [{ name: 'Uppal', latitude: 17.3984, longitude: 78.5583 }];
    geocodingCache.set(testKey, dummyResults);

    const cached = geocodingCache.get(testKey);
    assert.deepStrictEqual(cached, dummyResults);
  });

  // 4. Routing Abstraction
  await asyncTest('4. Routing service abstraction & interface', async () => {
    routingCache.clear();
    const origin = { latitude: 17.3984, longitude: 78.5583 };
    const destination = { latitude: 17.4528, longitude: 78.6835 };

    const routeRes = await routingService.route(origin, destination);
    assert.ok(routeRes);
    assert.ok(Array.isArray(routeRes.geometry));
    assert.ok(routeRes.geometry.length >= 2);
    assert.strictEqual(typeof routeRes.distanceMeters, 'number');
    assert.strictEqual(typeof routeRes.durationSeconds, 'number');
    assert.ok(routeRes.provider);
  });

  // 5. Provider Failure Fallback
  await asyncTest('5. Provider failure fallback behavior', async () => {
    const origin = { latitude: 17.3984, longitude: 78.5583 };
    const destination = { latitude: 17.4528, longitude: 78.6835 };

    // Create a RoutingService instance pointing to an invalid URL
    const { RoutingService } = require('../../lib/routing');
    const badService = new RoutingService({
      provider: 'osrm',
      baseUrl: 'https://invalid-osrm-url-xyz-12345.org',
      timeoutMs: 500,
      useCache: false
    });

    const fallbackRes = await badService.route(origin, destination);
    assert.ok(fallbackRes);
    assert.strictEqual(fallbackRes.provider, 'fallback-straight-line');
    assert.strictEqual(fallbackRes.geometry.length, 2);
  });

  // 6. Invalid Coordinates Handling
  test('6. Invalid coordinates handling', () => {
    assert.throws(() => {
      normalizeLocation({ lat: 'invalid', lon: 78.5583 });
    }, /Invalid location coordinates/);

    assert.throws(() => {
      normalizeLocation({ lat: 195, lon: 78.5583 });
    }, /Coordinates out of bounds/);
  });

  // 7. Missing Geocoder Result Handling
  await asyncTest('7. Missing geocoder result gracefully handled', async () => {
    const results = await geocoderService.search('');
    assert.deepStrictEqual(results, []);
  });

  // 8. Route Geometry Passed Unchanged into Matcher
  test('8. Route geometry passed unchanged into matcher adapter', () => {
    const userGeom = [[17.3984, 78.5583], [17.4200, 78.6000], [17.4528, 78.6835]];
    const candGeom = [[17.3750, 78.5600], [17.4200, 78.6000], [17.4528, 78.6835]];

    const adapted = adaptRouteForMatching(
      { id: 'user1', a_pickup_lat: 17.3984, a_pickup_lon: 78.5583, a_drop_lat: 17.4528, a_drop_lon: 78.6835 },
      { id: 'cand1' },
      userGeom,
      candGeom
    );

    assert.deepStrictEqual(adapted.userRouteGeometry, userGeom);
    assert.deepStrictEqual(adapted.candidateRouteGeometry, candGeom);
    assert.ok(adapted.meetingPoint);
    assert.ok(adapted.sharedGeometry);
  });

  // 9. Zero Hardcoded Geographic Data Assertions
  test('9. Zero hardcoded geographic data assertions', () => {
    const nominatimCode = require('fs').readFileSync(require.resolve('../../lib/geocoding/nominatim.js'), 'utf8');
    const locationCode = require('fs').readFileSync(require.resolve('../../lib/location/index.js'), 'utf8');
    const meetingCode = require('fs').readFileSync(require.resolve('../../lib/matching/dynamic_meeting.js'), 'utf8');

    assert.strictEqual(nominatimCode.includes('Uppal'), false);
    assert.strictEqual(nominatimCode.includes('500039'), false);
    assert.strictEqual(locationCode.includes('Hyderabad'), false);
    assert.strictEqual(meetingCode.includes('Ghatkesar'), false);
  });

  // 10. Dynamic Meeting Point Geometry Calculation
  test('10. Dynamic meeting point geometry calculation', () => {
    const userRoute = [[17.40, 78.50], [17.42, 78.55], [17.45, 78.60]];
    const candRoute = [[17.38, 78.48], [17.40, 78.50], [17.42, 78.55], [17.45, 78.60]];

    const dynamicRes = computeDynamicMeetingData(
      userRoute,
      candRoute,
      { lat: 17.40, lon: 78.50 },
      { lat: 17.45, lon: 78.60 }
    );

    assert.ok(dynamicRes.meetingPoint);
    assert.strictEqual(typeof dynamicRes.meetingPoint.latitude, 'number');
    assert.strictEqual(typeof dynamicRes.meetingPoint.longitude, 'number');
    assert.ok(dynamicRes.sharedGeometry.length >= 2);
    assert.ok(dynamicRes.sharedDistanceKm > 0);
  });

  // 11. PMTiles Prototype File Integrity
  test('11. MapLibre prototype HTML & JS file integrity', () => {
    const fs = require('fs');
    const html = fs.readFileSync(require.resolve('../../public/map/index.html'), 'utf8');
    const js = fs.readFileSync(require.resolve('../../public/map/prototype.js'), 'utf8');

    assert.ok(html.includes('maplibre-gl'));
    assert.ok(html.includes('pmtiles'));
    assert.ok(html.includes('OpenStreetMap'));
    assert.ok(js.includes('maplibregl.Map'));
    assert.ok(js.includes('pmtiles.Protocol'));
  });

  console.log('==================================================');
  console.log(`FINAL RESULT: ${passed} / ${total} tests passed.`);
  console.log('==================================================');

  if (passed !== total) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
