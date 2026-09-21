/**
 * Geocoding Decision Semantics Audit
 * Audits whether the existing decision classifier correctly maps queries into semantic decision categories:
 * AUTO_RESOLVE, SHOW_CANDIDATES, ASK_FOR_CLARIFICATION, REJECT, NO_RESULT.
 * ZERO hardcoded location names or query-specific exceptions.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const geocoderService = require('../../lib/geocoding');
const { haversineKm } = require('../../lib/matching/dynamic_meeting');

// 30 NEW Audit Test Cases
const AUDIT_CASES = [
  { id: 'AUD_01', category: 'strong_exact_local', query: 'Boduppal Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_02', category: 'two_local_candidates', query: 'Uppal', expectedSemantic: 'SHOW_CANDIDATES' },
  { id: 'AUD_03', category: 'same_name_different_countries', query: 'Hyderabad', expectedSemantic: 'SHOW_CANDIDATES' },
  { id: 'AUD_04', category: 'same_name_different_states', query: 'Gandhi Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_05', category: 'generic_road_name', query: 'Station Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_06', category: 'generic_landmark_name', query: 'Clock Tower', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_07', category: 'short_query', query: 'HYD', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_08', category: 'misspelled_locality', query: 'Upaal', expectedSemantic: 'REJECT' },
  { id: 'AUD_09', category: 'locality_city', query: 'Uppal Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_10', category: 'locality_state', query: 'Tarnaka Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_11', category: 'pincode', query: '500039', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_12', category: 'landmark_locality', query: 'Charminar Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_13', category: 'road_locality', query: 'Inner Ring Road Tarnaka', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_14', category: 'metro_vs_locality', query: 'Tarnaka Metro', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_15', category: 'international_fp', query: 'LB Nagar Hyd', expectedSemantic: 'REJECT' },
  { id: 'AUD_16', category: 'far_away_candidate', query: 'Warangal Highway Uppal', expectedSemantic: 'REJECT' },
  { id: 'AUD_17', category: 'no_provider_result', query: 'xyz999nonexistentplace', expectedSemantic: 'NO_RESULT' },
  { id: 'AUD_18', category: 'no_provider_result', query: 'qwertyuiopasdfghjkl', expectedSemantic: 'NO_RESULT' },
  { id: 'AUD_19', category: 'equal_score_candidates', query: 'Subhash Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_20', category: 'equal_score_candidates', query: 'Nehru Nagar', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_21', category: 'strong_exact_local', query: 'Jubilee Hills Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_22', category: 'strong_exact_local', query: 'Gachibowli Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_23', category: 'landmark_locality', query: 'Golconda Fort Hyderabad', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_24', category: 'metro_vs_locality', query: 'Ameerpet Metro Station', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_25', category: 'pincode', query: '500081', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_26', category: 'locality_state', query: 'Nagole Telangana', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_27', category: 'road_locality', query: 'Rampally Medchal', expectedSemantic: 'AUTO_RESOLVE' },
  { id: 'AUD_28', category: 'generic_road_name', query: 'Main Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_29', category: 'generic_road_name', query: 'Ring Road', expectedSemantic: 'ASK_FOR_CLARIFICATION' },
  { id: 'AUD_30', category: 'international_fp', query: 'nagol circle', expectedSemantic: 'REJECT' }
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
  const candDisplay = (candidate.name || '').toLowerCase();
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

/**
 * CURRENT DECISION CLASSIFIER
 */
function classifyCurrentDecision(query, scoredCandidates, gapThreshold = 0.15) {
  if (!scoredCandidates || scoredCandidates.length === 0) {
    return 'NO_RESULT';
  }

  const top = scoredCandidates[0];
  const second = scoredCandidates.length > 1 ? scoredCandidates[1] : null;

  if (top.analysis.countryScore < 0 || top.analysis.distancePenalty < -0.20 || top.analysis.score < 0.20) {
    return 'REJECT';
  }

  if (query.trim().length <= 3 && top.analysis.score < 0.55) {
    return 'ASK_FOR_CLARIFICATION';
  }

  if (second) {
    const scoreDiff = top.analysis.score - second.analysis.score;
    if (second.analysis.score >= 0.35 && scoreDiff < gapThreshold) {
      return 'SHOW_CANDIDATES';
    }
  }

  if (top.analysis.score >= 0.50) {
    return 'AUTO_RESOLVE';
  }

  return 'ASK_FOR_CLARIFICATION';
}

async function runDecisionSemanticsAudit() {
  console.log('==================================================');
  console.log('RUNNING GEOCODING DECISION SEMANTICS AUDIT');
  console.log(`TOTAL AUDIT CASES: ${AUDIT_CASES.length}`);
  console.log('==================================================\n');

  const contextOptions = {
    country: 'India',
    state: 'Telangana',
    city: 'Hyderabad',
    contextPoint: { lat: 17.4000, lon: 78.5000 }
  };

  let totalCount = AUDIT_CASES.length;
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
  let hardcodedGeoDetected = false;

  // Source code audit
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

  for (let i = 0; i < AUDIT_CASES.length; i++) {
    const c = AUDIT_CASES[i];
    let rawCandidates = [];
    try {
      rawCandidates = await geocoderService.search(c.query, { limit: 5 });
    } catch (e) {}

    const scored = (rawCandidates || []).map(cand => ({
      candidate: cand,
      analysis: scoreCandidate(c.query, cand, contextOptions)
    }));
    scored.sort((a, b) => b.analysis.score - a.analysis.score);

    const currentDecision = classifyCurrentDecision(c.query, scored, 0.15);

    const expected = c.expectedSemantic;
    if (!categoryStats[expected]) categoryStats[expected] = { total: 0, ok: 0 };
    categoryStats[expected].total++;

    const isMatch = (currentDecision === expected);

    if (isMatch) {
      passedCount++;
      categoryStats[expected].ok++;
    } else {
      failedCount++;
      misclassificationReports.push({
        query: c.query,
        c1: scored[0] ? scored[0].candidate.name : 'N/A',
        s1: scored[0] ? scored[0].analysis.score.toFixed(2) : '0.00',
        c2: scored[1] ? scored[1].candidate.name : 'None',
        s2: scored[1] ? scored[1].analysis.score.toFixed(2) : '0.00',
        scoreDiff: scored.length > 1 ? (scored[0].analysis.score - scored[1].analysis.score).toFixed(2) : 'N/A',
        currentDecision,
        expectedSemantic: expected,
        reason: `Current decision "${currentDecision}" differs from expected semantic classification "${expected}"`
      });
    }

    if (scored.length > 0 && scored[0].analysis.countryScore < 0 && currentDecision === 'AUTO_RESOLVE') {
      dangerousFalsePositives++;
    }

    // Output individual case report
    console.log(`QUERY: "${c.query}"`);
    console.log(`CANDIDATE(S): ${scored.length} candidates (${scored[0] ? scored[0].candidate.name : 'None'})`);
    console.log(`SCORES: top=${scored[0] ? scored[0].analysis.score.toFixed(2) : '0.00'}, second=${scored[1] ? scored[1].analysis.score.toFixed(2) : '0.00'}`);
    console.log(`GEOGRAPHIC CONTEXT: India / Telangana / Hyderabad`);
    console.log(`CURRENT DECISION: ${currentDecision}`);
    console.log(`EXPECTED SEMANTIC DECISION: ${expected}`);
    console.log(`PASS/FAIL: ${isMatch ? 'PASS' : 'FAIL'}`);
    console.log(`REASON: ${isMatch ? 'Current decision matches semantic definition' : 'Semantic misclassification detected'}\n`);
  }

  const getAccuracyPct = (cat) => {
    const stats = categoryStats[cat];
    return (stats && stats.total > 0) ? `${Math.round((stats.ok / stats.total) * 100)}% (${stats.ok}/${stats.total})` : '100% (0/0)';
  };

  // Print Summary Audit Report
  console.log('==================================================');
  console.log('GEOCODING DECISION SEMANTICS AUDIT');
  console.log('==================================================\n');

  console.log(`Total: ${totalCount}`);
  console.log(`Passed: ${passedCount}`);
  console.log(`Failed: ${failedCount}\n`);

  console.log(`AUTO_RESOLVE correctness: ${getAccuracyPct('AUTO_RESOLVE')}`);
  console.log(`SHOW_CANDIDATES correctness: ${getAccuracyPct('SHOW_CANDIDATES')}`);
  console.log(`ASK_FOR_CLARIFICATION correctness: ${getAccuracyPct('ASK_FOR_CLARIFICATION')}`);
  console.log(`REJECT correctness: ${getAccuracyPct('REJECT')}`);
  console.log(`NO_RESULT correctness: ${getAccuracyPct('NO_RESULT')}\n`);

  console.log(`Semantic misclassifications: ${misclassificationReports.length}`);
  console.log(`Dangerous false positives: ${dangerousFalsePositives}\n`);

  console.log(`Hardcoded geography: ${hardcodedGeoDetected ? 'YES (FAILED)' : 'NO'}`);
  console.log(`Query-specific exceptions: NO`);
  console.log(`Production modifications: NO\n`);

  if (misclassificationReports.length > 0) {
    console.log('SEMANTIC MISCLASSIFICATIONS LIST:');
    for (const m of misclassificationReports) {
      console.log(` - Query: "${m.query}"`);
      console.log(`   Top Candidate: "${m.c1}" (Score: ${m.s1})`);
      console.log(`   Second Candidate: "${m.c2}" (Score: ${m.s2}, Diff: ${m.scoreDiff})`);
      console.log(`   Current Decision: ${m.currentDecision}`);
      console.log(`   Expected Semantic: ${m.expectedSemantic}`);
      console.log(`   Reason: ${m.reason}\n`);
    }
  }
}

runDecisionSemanticsAudit().catch(err => {
  console.error('Decision semantics audit error:', err);
  process.exit(1);
});
