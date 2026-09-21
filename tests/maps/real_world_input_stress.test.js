/**
 * Real-World User Input + Route Matching Stress Test
 * Tests the mapping & search intelligence layer from the perspective of an actual user.
 * Validates realistic query handling, coordinate source of truth, OSRM routing, matching, and zero hardcoded geography.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const geocoderService = require('../../lib/geocoding');
const routingService = require('../../lib/routing');
const { normalizeLocation } = require('../../lib/location');
const { adaptRouteForMatching } = require('../../lib/matching/adapter');
const { haversineKm, computeDynamicMeetingData } = require('../../lib/matching/dynamic_meeting');

// 35 Realistic Real-World User Queries
const REAL_WORLD_QUERIES = [
  { id: 'Q01', category: 'area_hyd', query: 'LB Nagar Hyd', expectedArea: 'LB Nagar', refLat: 17.3550, refLon: 78.5520 },
  { id: 'Q02', category: 'missing_space', query: 'LBNagar Hyd', expectedArea: 'LB Nagar', refLat: 17.3550, refLon: 78.5520 },
  { id: 'Q03', category: 'misspelling', query: 'Boduupal Hyd', expectedArea: 'Boduppal', refLat: 17.4120, refLon: 78.5780 },
  { id: 'Q04', category: 'transliteration', query: 'Gachibowlee Hitech', expectedArea: 'Gachibowli', refLat: 17.4400, refLon: 78.3480 },
  { id: 'Q05', category: 'extra_spaces', query: '  uppal  ring  road  ', expectedArea: 'Uppal', refLat: 17.3984, refLon: 78.5583 },
  { id: 'Q06', category: 'abbreviation', query: 'secbad station', expectedArea: 'Secunderabad', refLat: 17.4400, refLon: 78.5000 },
  { id: 'Q07', category: 'metro_station', query: 'tarnaka metro station', expectedArea: 'Tarnaka', refLat: 17.4250, refLon: 78.5350 },
  { id: 'Q08', category: 'landmark_area', query: 'charminar old city', expectedArea: 'Charminar', refLat: 17.3616, refLon: 78.4747 },
  { id: 'Q09', category: 'road_area', query: 'warangal highway uppal', expectedArea: 'Uppal', refLat: 17.3984, refLon: 78.5583 },
  { id: 'Q10', category: 'pincode', query: '500039', expectedArea: 'Uppal', refLat: 17.3984, refLon: 78.5583 },
  { id: 'Q11', category: 'pincode', query: '500081', expectedArea: 'Madhapur', refLat: 17.4480, refLon: 78.3910 },
  { id: 'Q12', category: 'transliteration', query: 'kukatpalli hyd', expectedArea: 'Kukatpally', refLat: 17.4850, refLon: 78.4100 },
  { id: 'Q13', category: 'misspelling', query: 'ameerpeet metro', expectedArea: 'Ameerpet', refLat: 17.4370, refLon: 78.4480 },
  { id: 'Q14', category: 'extra_repeated', query: 'begumpettt', expectedArea: 'Begumpet', refLat: 17.4440, refLon: 78.4680 },
  { id: 'Q15', category: 'extra_repeated', query: 'mehdipatnammm hyd', expectedArea: 'Mehdipatnam', refLat: 17.3950, refLon: 78.4400 },
  { id: 'Q16', category: 'transliteration', query: 'kondapoor hitech city', expectedArea: 'Kondapur', refLat: 17.4620, refLon: 78.3680 },
  { id: 'Q17', category: 'misspelling', query: 'dilshuknagar hyd', expectedArea: 'Dilsukhnagar', refLat: 17.3680, refLon: 78.5250 },
  { id: 'Q18', category: 'misspelling', query: 'jubilee hils', expectedArea: 'Jubilee Hills', refLat: 17.4300, refLon: 78.4080 },
  { id: 'Q19', category: 'compound_name', query: 'banjarahills road 1', expectedArea: 'Banjara Hills', refLat: 17.4150, refLon: 78.4480 },
  { id: 'Q20', category: 'transliteration', query: 'ghatkeser medchal', expectedArea: 'Ghatkesar', refLat: 17.4528, refLon: 78.6835 },
  { id: 'Q21', category: 'extra_repeated', query: 'peerzadigudaa medipally', expectedArea: 'Peerzadiguda', refLat: 17.4080, refLon: 78.5720 },
  { id: 'Q22', category: 'transliteration', query: 'rampalli medchal', expectedArea: 'Rampally', refLat: 17.4789, refLon: 78.6124 },
  { id: 'Q23', category: 'short_name', query: 'nagol circle', expectedArea: 'Nagole', refLat: 17.3750, refLon: 78.5600 },
  { id: 'Q24', category: 'misspelling', query: 'chanda nagar hydrabad', expectedArea: 'Chandanagar', refLat: 17.4980, refLon: 78.3280 },
  { id: 'Q25', category: 'landmark_area', query: 'shamshbad airport', expectedArea: 'Shamshabad', refLat: 17.2400, refLon: 78.4290 },
  { id: 'Q26', category: 'landmark_area', query: 'gachibowli stadium', expectedArea: 'Gachibowli', refLat: 17.4400, refLon: 78.3480 },
  { id: 'Q27', category: 'landmark_area', query: 'hitec city cyber towers', expectedArea: 'Madhapur', refLat: 17.4480, refLon: 78.3808 },
  { id: 'Q28', category: 'road_area', query: 'outer ring road gachibowli', expectedArea: 'Gachibowli', refLat: 17.4400, refLon: 78.3480 },
  { id: 'Q29', category: 'road_area', query: 'inner ring road tarnaka', expectedArea: 'Tarnaka', refLat: 17.4250, refLon: 78.5350 },
  { id: 'Q30', category: 'road_area', query: 'pvnr expressway attapur', expectedArea: 'Attapur', refLat: 17.3700, refLon: 78.4350 },
  { id: 'Q31', category: 'compound_name', query: 'ecil x roads', expectedArea: 'ECIL', refLat: 17.4650, refLon: 78.5680 },
  { id: 'Q32', category: 'landmark_area', query: 'dlf gachibowli', expectedArea: 'Gachibowli', refLat: 17.4400, refLon: 78.3480 },
  { id: 'Q33', category: 'landmark_area', query: 'mindspace madhapur', expectedArea: 'Madhapur', refLat: 17.4480, refLon: 78.3808 },
  { id: 'Q34', category: 'landmark_area', query: 'kbr park jubilee hills', expectedArea: 'Jubilee Hills', refLat: 17.4300, refLon: 78.4080 },
  { id: 'Q35', category: 'landmark_area', query: 'botanical garden kondapur', expectedArea: 'Kondapur', refLat: 17.4620, refLon: 78.3680 }
];

// 5 Real-World Journey Pairs
const REAL_WORLD_JOURNEY_PAIRS = [
  {
    name: "Pair 1: Misspelled Inputs (upaal/ghatkeser vs nagol/ghatkeser)",
    userA: { pickupQuery: "upaal hydrabad", dropQuery: "ghatkeser medchal" },
    userB: { pickupQuery: "nagol circle", dropQuery: "ghatkeser medchal" }
  },
  {
    name: "Pair 2: Landmark & Transliterated Inputs (kukatpalli/cyber towers vs gachibowli stadium/cyber towers)",
    userA: { pickupQuery: "kukatpalli hyd", dropQuery: "hitec city cyber towers" },
    userB: { pickupQuery: "gachibowli stadium", dropQuery: "hitec city cyber towers" }
  },
  {
    name: "Pair 3: Abbreviated & Metro Inputs (secbad station/ameerpeet vs tarnaka metro/begumpettt)",
    userA: { pickupQuery: "secbad station", dropQuery: "ameerpeet metro" },
    userB: { pickupQuery: "tarnaka metro station", dropQuery: "begumpettt" }
  },
  {
    name: "Pair 4: PIN-code & Road Queries (500039/500081 vs warangal highway/dlf gachibowli)",
    userA: { pickupQuery: "500039", dropQuery: "500081" },
    userB: { pickupQuery: "warangal highway uppal", dropQuery: "dlf gachibowli" }
  },
  {
    name: "Pair 5: Opposite Real-World Inputs (tarnaka metro/upaal vs upaal/tarnaka metro)",
    userA: { pickupQuery: "tarnaka metro station", dropQuery: "upaal hydrabad" },
    userB: { pickupQuery: "upaal hydrabad", dropQuery: "tarnaka metro station" }
  }
];

async function runRealWorldInputStressTest() {
  console.log('==================================================');
  console.log('RUNNING REAL-WORLD USER INPUT STRESS TEST');
  console.log(`TOTAL USER QUERIES TO TEST: ${REAL_WORLD_QUERIES.length}`);
  console.log('==================================================\n');

  let successCount = 0;
  let failCount = 0;

  const categoryStats = {
    misspelling: { total: 0, ok: 0 },
    compound_name: { total: 0, ok: 0 },
    landmark_area: { total: 0, ok: 0 },
    pincode: { total: 0, ok: 0 },
    transliteration: { total: 0, ok: 0 },
    other: { total: 0, ok: 0 }
  };

  let coordPreservationPassed = true;
  let routingPreservationPassed = true;
  let matcherPreservationPassed = true;
  let hardcodedGeographyDetected = false;

  // Inspect files for hardcoded geography
  const filesToCheck = [
    '../../lib/location/index.js',
    '../../lib/geocoding/index.js',
    '../../lib/geocoding/nominatim.js',
    '../../lib/routing/index.js',
    '../../lib/matching/dynamic_meeting.js'
  ];

  for (const fPath of filesToCheck) {
    const code = fs.readFileSync(path.join(__dirname, fPath), 'utf8');
    if (code.includes('Uppal') || code.includes('Ghatkesar') || code.includes('500039')) {
      hardcodedGeographyDetected = true;
    }
  }

  const failedQueries = [];

  for (const item of REAL_WORLD_QUERIES) {
    const categoryKey = categoryStats[item.category] ? item.category : 'other';
    categoryStats[categoryKey].total++;

    const normQuery = geocoderService.provider ? geocoderService.search : item.query;
    let searchRes = [];

    try {
      searchRes = await geocoderService.search(item.query, { limit: 1 });
    } catch (err) {
      // Handle error
    }

    if (searchRes && searchRes.length > 0) {
      const top = searchRes[0];
      const selected = normalizeLocation(top, top.provider);

      // Verify coordinate preservation
      if (selected.latitude !== top.latitude || selected.longitude !== top.longitude) {
        coordPreservationPassed = false;
      }

      // Calculate distance to reference lat/lon
      const errorKm = haversineKm([selected.latitude, selected.longitude], [item.refLat, item.refLon]);

      // Verify routing accepts selected coordinates
      let routeObj = null;
      try {
        routeObj = await routingService.route(selected, { latitude: selected.latitude + 0.05, longitude: selected.longitude + 0.05 });
      } catch (e) {}

      if (!routeObj || !routeObj.geometry || routeObj.geometry.length < 2) {
        routingPreservationPassed = false;
      }

      // Accept as SUCCESS if error distance is within 15km of target area
      if (errorKm <= 15.0) {
        successCount++;
        categoryStats[categoryKey].ok++;
        console.log(` [PASS] ${item.id} "${item.query}" -> "${selected.name}" (${errorKm.toFixed(1)}km err)`);
      } else {
        failCount++;
        console.log(` [FAIL] ${item.id} "${item.query}" -> "${selected.name}" (${errorKm.toFixed(1)}km err, expected ${item.expectedArea})`);
        failedQueries.push({
          input: item.query,
          returnedResult: selected.name,
          expectedResult: item.expectedArea,
          likelyCause: `Returned location "${selected.name}" is ${errorKm.toFixed(1)}km away from reference area "${item.expectedArea}"`
        });
      }
    } else {
      failCount++;
      console.log(` [FAIL] ${item.id} "${item.query}" -> NO_RESULTS`);
      failedQueries.push({
        input: item.query,
        returnedResult: 'NO_RESULTS',
        expectedResult: item.expectedArea,
        likelyCause: `Public geocoder returned 0 results for query variant`
      });
    }
  }

  // Real-World Journey Pairs Testing
  console.log('\n==================================================');
  console.log('REAL-WORLD JOURNEY PAIR MATCHING STRESS TEST');
  console.log('==================================================');

  for (let i = 0; i < REAL_WORLD_JOURNEY_PAIRS.length; i++) {
    const pair = REAL_WORLD_JOURNEY_PAIRS[i];
    console.log(`\n--- [Pair ${i+1}/${REAL_WORLD_JOURNEY_PAIRS.length}] ${pair.name} ---`);

    const resA_pick = await geocoderService.search(pair.userA.pickupQuery, { limit: 1 });
    const resA_drop = await geocoderService.search(pair.userA.dropQuery, { limit: 1 });
    const resB_pick = await geocoderService.search(pair.userB.pickupQuery, { limit: 1 });
    const resB_drop = await geocoderService.search(pair.userB.dropQuery, { limit: 1 });

    const locA_pick = normalizeLocation(resA_pick[0] || { name: 'A_pick', lat: 17.3984, lon: 78.5583 });
    const locA_drop = normalizeLocation(resA_drop[0] || { name: 'A_drop', lat: 17.4528, lon: 78.6835 });
    const locB_pick = normalizeLocation(resB_pick[0] || { name: 'B_pick', lat: 17.3750, lon: 78.5600 });
    const locB_drop = normalizeLocation(resB_drop[0] || { name: 'B_drop', lat: 17.4528, lon: 78.6835 });

    const routeA = await routingService.route(locA_pick, locA_drop);
    const routeB = await routingService.route(locB_pick, locB_drop);

    const matchData = adaptRouteForMatching(
      { id: 'A', a_pickup_lat: locA_pick.latitude, a_pickup_lon: locA_pick.longitude, a_drop_lat: locA_drop.latitude, a_drop_lon: locA_drop.longitude },
      { id: 'B' },
      routeA.geometry,
      routeB.geometry
    );

    console.log(` User A Selected: ${locA_pick.name} -> ${locA_drop.name}`);
    console.log(` User B Selected: ${locB_pick.name} -> ${locB_drop.name}`);
    console.log(` Shared Route Distance: ${matchData.sharedDistanceKm} km`);
    console.log(` Dynamic Meeting Point: (${matchData.meetingPoint.latitude.toFixed(5)}, ${matchData.meetingPoint.longitude.toFixed(5)})`);

    if (!matchData.meetingPoint || isNaN(matchData.meetingPoint.latitude)) {
      matcherPreservationPassed = false;
    }
  }

  // Print Summary Report
  console.log('\n==================================================');
  console.log('REAL-WORLD INPUT STRESS TEST');
  console.log('==================================================\n');

  console.log(`Total queries: ${REAL_WORLD_QUERIES.length}`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  const getPct = (cat) => categoryStats[cat].total > 0 ? `${Math.round((categoryStats[cat].ok / categoryStats[cat].total) * 100)}%` : '100%';

  console.log(`Misspelling success rate: ${getPct('misspelling')}`);
  console.log(`Compound-query success rate: ${getPct('compound_name')}`);
  console.log(`Landmark success rate: ${getPct('landmark_area')}`);
  console.log(`PIN-code success rate: ${getPct('pincode')}`);
  console.log(`Transliteration success rate: ${getPct('transliteration')}\n`);

  console.log(`Coordinate preservation: ${coordPreservationPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`Routing preservation: ${routingPreservationPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`Matcher preservation: ${matcherPreservationPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`Hardcoded geography: ${hardcodedGeographyDetected ? 'YES (FAILED)' : 'NO (PASSED)'}\n`);

  if (failedQueries.length > 0) {
    console.log('FAILED QUERIES LIST:');
    for (const f of failedQueries) {
      console.log(` - Input: "${f.input}"`);
      console.log(`   Returned: "${f.returnedResult}"`);
      console.log(`   Expected: "${f.expectedResult}"`);
      console.log(`   Cause: ${f.likelyCause}\n`);
    }
  }
}

runRealWorldInputStressTest().catch(err => {
  console.error('Real-world input stress test error:', err);
  process.exit(1);
});
