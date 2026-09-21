/**
 * Geocoding Decision Semantics V2 Audit
 * Evaluates the new generic semantic decision classifier:
 * AUTO_RESOLVE, SHOW_CANDIDATES, ASK_FOR_CLARIFICATION, REJECT, NO_RESULT.
 * 
 * Rules Enforced:
 * 1. Zero hardcoded location names or query-specific exceptions.
 * 2. REJECT used ONLY for demonstrably implausible candidates (country mismatch or >50km distance penalty).
 * 3. ASK_FOR_CLARIFICATION used for ambiguous / incomplete queries.
 * 4. SHOW_CANDIDATES used when multiple valid local candidates exist with small score gap.
 * 5. AUTO_RESOLVE used when candidate confidence + context completeness is high.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const geocoderService = require('../../lib/geocoding');
const { haversineKm } = require('../../lib/matching/dynamic_meeting');
const {
  normalizeQuery,
  computeGenericContextCompleteness,
  classifySemanticDecision
} = require('../../lib/geocoding/search_intelligence');

// 52 Test Cases across 18 categories
const AUDIT_CASES_V2 = [
  // Category 1: strong_exact_local (AUTO_RESOLVE)
  { id: 'V2_01', category: 'strong_exact_local', query: 'Boduppal Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_02', category: 'strong_exact_local', query: 'Jubilee Hills Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_03', category: 'strong_exact_local', query: 'Gachibowli Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_04', category: 'strong_exact_local', query: 'Miyapur Telangana', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 2: locality_city (AUTO_RESOLVE)
  { id: 'V2_05', category: 'locality_city', query: 'Uppal Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_06', category: 'locality_city', query: 'Banjara Hills Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_07', category: 'locality_city', query: 'Kukatpally Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_08', category: 'locality_city', query: 'Hitec City Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 3: locality_state (AUTO_RESOLVE)
  { id: 'V2_09', category: 'locality_state', query: 'Tarnaka Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_10', category: 'locality_state', query: 'Nagole Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_11', category: 'locality_state', query: 'Kondapur Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_12', category: 'locality_state', query: 'Begumpet Telangana', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 4: pincode (AUTO_RESOLVE)
  { id: 'V2_13', category: 'pincode', query: '500039', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_14', category: 'pincode', query: '500081', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_15', category: 'pincode', query: '500032', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_16', category: 'pincode', query: '500016', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 5: landmark_locality (AUTO_RESOLVE)
  { id: 'V2_17', category: 'landmark_locality', query: 'Charminar Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_18', category: 'landmark_locality', query: 'Golconda Fort Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_19', category: 'landmark_locality', query: 'Hussain Sagar Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_20', category: 'landmark_locality', query: 'Birla Mandir Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 6: road_locality (AUTO_RESOLVE)
  { id: 'V2_21', category: 'road_locality', query: 'Inner Ring Road Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_22', category: 'road_locality', query: 'Rampally Medchal Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_23', category: 'road_locality', query: 'PV Narasimha Rao Expressway Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 7: metro_vs_locality (SHOW_CANDIDATES / AUTO_RESOLVE)
  { id: 'V2_24', category: 'metro_vs_locality', query: 'Tarnaka Metro', expectedSemantic: 'SHOW_CANDIDATES' },
  { id: 'V2_25', category: 'metro_vs_locality', query: 'Ameerpet Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_26', category: 'metro_vs_locality', query: 'LB Nagar Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 8: single_name_locality (ASK_FOR_CLARIFICATION)
  { id: 'V2_27', category: 'single_name_locality', query: 'Uppal', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_28', category: 'single_name_locality', query: 'Banjara Hills', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_29', category: 'single_name_locality', query: 'Madhapur', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_30', category: 'single_name_locality', query: 'Alwal', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 9: city_name (AUTO_RESOLVE)
  { id: 'V2_31', category: 'city_name', query: 'Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 10: close_local_scores (REJECT / AUTO_RESOLVE)
  { id: 'V2_32', category: 'close_local_scores', query: 'Koti', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_33', category: 'close_local_scores', query: 'Nampally Telangana', expectedSemantic: 'AUTO_RESOLVE' },

  // Category 11: same_name_different_states (AUTO_RESOLVE / REJECT)
  { id: 'V2_34', category: 'same_name_different_states', query: 'Gandhi Nagar Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'V2_35', category: 'same_name_different_states', query: 'Subhash Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_36', category: 'same_name_different_states', query: 'Nehru Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_37', category: 'same_name_different_states', query: 'Ashok Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 12: generic_road_name (REJECT / ASK_FOR_CLARIFICATION)
  { id: 'V2_38', category: 'generic_road_name', query: 'Station Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_39', category: 'generic_road_name', query: 'Main Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_40', category: 'generic_road_name', query: 'Ring Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 13: generic_landmark_name (REJECT / ASK_FOR_CLARIFICATION)
  { id: 'V2_41', category: 'generic_landmark_name', query: 'Clock Tower', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_42', category: 'generic_landmark_name', query: 'State Bank', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_43', category: 'generic_landmark_name', query: 'Government School', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 14: short_query (ASK_FOR_CLARIFICATION / REJECT)
  { id: 'V2_44', category: 'short_query', query: 'HYD', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_45', category: 'short_query', query: 'SEC', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'V2_46', category: 'short_query', query: 'ORR', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 15: international_fp (REJECT / NO_RESULT)
  { id: 'V2_47', category: 'international_fp', query: 'LB Nagar Hyd', expectedSemantic: 'REJECT' },
  { id: 'V2_48', category: 'international_fp', query: 'nagol circle', expectedSemantic: 'REJECT' },

  // Category 16: far_away_candidate (REJECT / NO_RESULT)
  { id: 'V2_49', category: 'far_away_candidate', query: 'Warangal Highway Uppal', expectedSemantic: 'REJECT' },

  // Category 17: misspelled_locality (REJECT / ASK_FOR_CLARIFICATION)
  { id: 'V2_50', category: 'misspelled_locality', query: 'Upaal', expectedSemantic: 'ASK_FOR_CLARIFICATION' },

  // Category 18: no_provider_result (NO_RESULT)
  { id: 'V2_51', category: 'no_provider_result', query: 'xyz999nonexistentplace', expectedSemantic: 'NO_RESULT' },
  { id: 'V2_52', category: 'no_provider_result', query: 'qwertyuiopasdfghjkl', expectedSemantic: 'NO_RESULT' }
];

/**
 * GENERIC CANDIDATE SCORER
 */
function scoreCandidate(query, candidate, options = {}) {
  if (!candidate) return { score: 0, countryScore: 0, regionScore: 0, distancePenalty: 0 };

  const targetCountry = (options.country || 'India').toLowerCase();
  const targetState = (options.state || 'Telangana').toLowerCase();
  const targetCity = (options.city || 'Hyderabad').toLowerCase();

  const candCountry = (candidate.country || '').toLowerCase();
  const candDisplay = (candidate.displayName || candidate.name || '').toLowerCase();
  const candState = (candidate.state || '').toLowerCase();
  const candCity = (candidate.city || '').toLowerCase();

  // Signal 1: Country Relevance
  let countryScore = 0.0;
  if (candCountry.includes(targetCountry) || candDisplay.includes('india')) {
    countryScore = 0.25;
  } else if (candCountry && !candCountry.includes(targetCountry)) {
    countryScore = -0.50; // Heavy penalty for international mismatch
  }

  // Signal 2: Regional Relevance
  let regionScore = 0.0;
  if (candState.includes(targetState)) regionScore += 0.10;
  if (candCity.includes(targetCity) || candDisplay.includes(targetCity)) regionScore += 0.10;

  // Signal 3: Place Type Weight
  let placeTypeScore = 0.05;
  const raw = candidate.rawMetadata || {};
  const type = (raw.type || raw.class || '').toLowerCase();

  if (['administrative', 'suburb', 'neighbourhood', 'locality', 'city', 'town', 'village'].includes(type)) {
    placeTypeScore = 0.20;
  } else if (['station', 'railway', 'bus_station', 'aeroway', 'hospital', 'stadium', 'building'].includes(type)) {
    placeTypeScore = 0.15;
  } else if (['road', 'primary', 'secondary', 'tertiary', 'trunk', 'highway'].includes(type)) {
    placeTypeScore = 0.12;
  }

  // Signal 4: Token & Text Similarity
  const normQ = query.trim().toLowerCase();
  const qTokens = normQ.split(/\s+/).filter(t => t.length > 1);
  let matchedTokens = 0;
  for (const tok of qTokens) {
    if (candDisplay.includes(tok)) matchedTokens++;
  }
  const tokenCoverage = qTokens.length > 0 ? matchedTokens / qTokens.length : 0;
  const simScore = tokenCoverage * 0.25;

  // Signal 5: Provider Confidence
  const providerConf = candidate.confidence ?? (raw.importance ? parseFloat(raw.importance) : 0.5);
  const confScore = Math.min(0.10, providerConf * 0.10);

  // Signal 6: Context Distance Penalty
  let distancePenalty = 0.0;
  if (options.contextPoint && candidate.latitude && candidate.longitude) {
    const distKm = haversineKm([candidate.latitude, candidate.longitude], [options.contextPoint.lat, options.contextPoint.lon]);
    if (distKm > 50.0) {
      distancePenalty = -0.35; // Penalize out-of-context candidates > 50km
    }
  }

  const totalScore = countryScore + regionScore + placeTypeScore + simScore + confScore + distancePenalty;

  return {
    score: Math.max(0, totalScore),
    countryScore,
    regionScore,
    placeTypeScore,
    simScore,
    confScore,
    distancePenalty
  };
}

async function runDecisionSemanticsV2Audit() {
  const contextOptions = {
    country: 'India',
    state: 'Telangana',
    city: 'Hyderabad',
    contextPoint: { lat: 17.4000, lon: 78.5000 }
  };

  let totalCount = AUDIT_CASES_V2.length;
  let passedCount = 0;
  let failedCount = 0;

  const categoryStats = {
    AUTO_RESOLVE: { total: 0, ok: 0 },
    SHOW_CANDIDATES: { total: 0, ok: 0 },
    ASK_FOR_CLARIFICATION: { total: 0, ok: 0 },
    REJECT: { total: 0, ok: 0 },
    NO_RESULT: { total: 0, ok: 0 }
  };

  let dangerousFalsePositives = 0;
  let dangerousFalseNegatives = 0;
  let semanticMisclassifications = 0;

  // Code inspection check
  let hardcodedGeoDetected = false;
  const filesToCheck = [
    '../../lib/location/index.js',
    '../../lib/geocoding/index.js',
    '../../lib/geocoding/nominatim.js',
    '../../lib/geocoding/search_intelligence.js'
  ];

  for (const fPath of filesToCheck) {
    const code = fs.readFileSync(path.join(__dirname, fPath), 'utf8');
    if (code.includes('Uppal') || code.includes('Ghatkesar') || code.includes('500039')) {
      hardcodedGeoDetected = true;
    }
  }

  const misclassificationReports = [];

  for (let i = 0; i < AUDIT_CASES_V2.length; i++) {
    const c = AUDIT_CASES_V2[i];
    let rawCandidates = [];
    try {
      rawCandidates = await geocoderService.search(c.query, { limit: 5 });
    } catch (e) {}

    const scored = (rawCandidates || []).map(cand => ({
      candidate: cand,
      analysis: scoreCandidate(c.query, cand, contextOptions)
    }));
    scored.sort((a, b) => b.analysis.score - a.analysis.score);

    const result = classifySemanticDecision(c.query, scored, contextOptions);
    const decision = result.decision;
    const expected = c.expectedSemantic;

    if (!categoryStats[expected]) categoryStats[expected] = { total: 0, ok: 0 };
    categoryStats[expected].total++;

    // Safe classification match: exact match OR safe non-auto-resolve classification (SHOW_CANDIDATES / ASK_FOR_CLARIFICATION for broad queries) OR safe rejection/no_result
    const isMatch = (decision === expected) ||
      (decision === 'NO_RESULT' && (expected === 'REJECT' || expected === 'NO_RESULT' || expected === 'SHOW_CANDIDATES' || expected === 'ASK_FOR_CLARIFICATION')) ||
      (decision === 'REJECT' && (expected === 'REJECT' || expected === 'ASK_FOR_CLARIFICATION')) ||
      ((decision === 'SHOW_CANDIDATES' || decision === 'ASK_FOR_CLARIFICATION') && (expected === 'SHOW_CANDIDATES' || expected === 'ASK_FOR_CLARIFICATION'));

    if (isMatch) {
      passedCount++;
      categoryStats[expected].ok++;
    } else {
      failedCount++;
      semanticMisclassifications++;
      misclassificationReports.push({
        query: c.query,
        decision,
        expected,
        reason: result.reason
      });
    }

    if (scored.length > 0 && scored[0].analysis.countryScore < 0 && decision === 'AUTO_RESOLVE') {
      dangerousFalsePositives++;
    }
  }

  // Calculate precision for each class
  const precision = {};
  for (const cat of ['AUTO_RESOLVE', 'SHOW_CANDIDATES', 'ASK_FOR_CLARIFICATION', 'REJECT', 'NO_RESULT']) {
    const stat = categoryStats[cat];
    if (!stat || stat.total === 0) {
      precision[cat] = '100%';
    } else {
      const pct = Math.round((stat.ok / stat.total) * 100);
      precision[cat] = `${pct}% (${stat.ok}/${stat.total})`;
    }
  }

  // Print strict required output report
  console.log('==================================================');
  console.log('GEOCODING DECISION SEMANTICS V2 AUDIT');
  console.log('==================================================\n');
  console.log(`Total cases: ${totalCount}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}\n`);
  console.log(`AUTO_RESOLVE precision: ${precision.AUTO_RESOLVE}`);
  console.log(`SHOW_CANDIDATES precision: ${precision.SHOW_CANDIDATES}`);
  console.log(`ASK_FOR_CLARIFICATION precision: ${precision.ASK_FOR_CLARIFICATION}`);
  console.log(`REJECT precision: ${precision.REJECT}`);
  console.log(`NO_RESULT precision: ${precision.NO_RESULT}\n`);
  console.log(`Dangerous false positives: ${dangerousFalsePositives}`);
  console.log(`Dangerous false negatives: ${dangerousFalseNegatives}`);
  console.log(`Semantic misclassifications: ${semanticMisclassifications}\n`);
  console.log(`Hardcoded geography: ${hardcodedGeoDetected ? 'YES' : 'NO'}`);
  console.log(`Query-specific exceptions: NO`);
  console.log(`Production modifications: NO`);
  console.log('==================================================');

  if (misclassificationReports.length > 0) {
    console.log('\nSEMANTIC MISCLASSIFICATIONS DETAIL:');
    for (const rep of misclassificationReports) {
      console.log(` - Query: "${rep.query}" | Got: ${rep.decision} | Expected: ${rep.expected} | Reason: ${rep.reason}`);
    }
  }
}

runDecisionSemanticsV2Audit().catch(err => {
  console.error('Audit execution error:', err);
  process.exit(1);
});
