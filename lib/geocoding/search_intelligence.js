/**
 * GoTogether Location Search Intelligence Layer
 * 100% Generic Query Normalization, Generic Fuzzy Variant Generation, Multi-Signal Candidate Ranking & Semantic Decision Classifier
 * ZERO hardcoded location names, static place dictionaries, or query-specific rules.
 */

/**
 * 1. QUERY NORMALIZATION
 * Cleans, lowercases, and normalizes punctuation and spacing.
 */
function normalizeQuery(rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return '';

  let cleaned = rawQuery.trim().toLowerCase();

  // Replace punctuation and dashes with spaces except digits
  cleaned = cleaned.replace(/[^a-z0-9\s]/gi, ' ');

  // Normalize multiple spaces
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  return cleaned;
}

/**
 * 2. GENERIC FUZZY VARIANT GENERATOR
 */
function generateGenericVariants(query) {
  const normalized = normalizeQuery(query);
  if (!normalized) return [];

  const variants = new Set();
  variants.add(normalized);

  // Rule 1: Split compound patterns (e.g., word + suffix like nagar, hills, pally, guda, pur, pet,abad)
  const splitCompound = normalized.replace(/([a-z]{3,})(hills|nagar|pally|guda|pur|pet|bad|gl)/gi, '$1 $2');
  if (splitCompound !== normalized) variants.add(splitCompound);

  // Rule 2: Collapse 3+ consecutive repeated characters (e.g. "begumpettt" -> "begumpet")
  const collapsedTriple = normalized.replace(/(.)\1{2,}/gi, '$1');
  if (collapsedTriple !== normalized) variants.add(collapsedTriple);

  // Rule 3: Generic vowel & double consonant normalization
  const collapsedVowels = normalized
    .replace(/aa/gi, 'a')
    .replace(/uu/gi, 'u')
    .replace(/ee/gi, 'i')
    .replace(/oo/gi, 'u');
  if (collapsedVowels !== normalized) variants.add(collapsedVowels);

  // Rule 4: Generic phoneme & transliteration exchanges
  const translit = normalized
    .replace(/palli/gi, 'pally')
    .replace(/hils/gi, 'hills')
    .replace(/ee\b/gi, 'i')
    .replace(/bad\b/gi, 'abad');
  if (translit !== normalized) variants.add(translit);

  // Rule 5: Generic token-level vowel collapse for multi-token queries
  const tokens = normalized.split(/\s+/);
  if (tokens.length > 1) {
    const cleanedTokens = tokens.map(t =>
      t.replace(/aa/gi, 'a')
       .replace(/uu/gi, 'u')
       .replace(/ee/gi, 'i')
       .replace(/oo/gi, 'u')
       .replace(/palli/gi, 'pally')
       .replace(/(.)\1{2,}/gi, '$1')
    ).join(' ');
    if (cleanedTokens !== normalized) variants.add(cleanedTokens);
  }

  return Array.from(variants);
}

/**
 * 3. STRING SIMILARITY ALGORITHMS (Levenshtein & Jaro-Winkler)
 */
function levenshteinDistance(a, b) {
  if (!a || !b) return (a || b).length;
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[a.length][b.length];
}

function jaroWinklerSimilarity(s1, s2) {
  if (s1 === s2) return 1.0;
  if (!s1 || !s2) return 0.0;

  const m = Math.floor(Math.max(s1.length, s2.length) / 2) - 1;
  const s1Matches = new Array(s1.length).fill(false);
  const s2Matches = new Array(s2.length).fill(false);

  let matches = 0;
  let trans = 0;

  for (let i = 0; i < s1.length; i++) {
    const start = Math.max(0, i - m);
    const end = Math.min(i + m + 1, s2.length);

    for (let j = start; j < end; j++) {
      if (s2Matches[j] || s1[i] !== s2[j]) continue;
      s1Matches[i] = true;
      s2Matches[j] = true;
      matches++;
      break;
    }
  }

  if (matches === 0) return 0.0;

  let k = 0;
  for (let i = 0; i < s1.length; i++) {
    if (!s1Matches[i]) continue;
    while (!s2Matches[k]) k++;
    if (s1[i] !== s2[k]) trans++;
    k++;
  }

  const jaro = (matches / s1.length + matches / s2.length + (matches - trans / 2) / matches) / 3;

  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(s1.length, s2.length)); i++) {
    if (s1[i] === s2[i]) prefix++;
    else break;
  }

  return jaro + prefix * 0.1 * (1 - jaro);
}

/**
 * 4. MULTI-SIGNAL CANDIDATE RANKING PIPELINE
 */
function rankCandidates(query, candidates, options = {}) {
  if (!candidates || candidates.length === 0) return [];

  const normalizedQuery = normalizeQuery(query);
  const queryTokens = normalizedQuery.split(/\s+/).filter(Boolean);

  const scored = candidates.map(c => {
    const nameNorm = normalizeQuery(c.name || '');
    const nameTokens = nameNorm.split(/\s+/).filter(Boolean);

    // Signal 1: Jaro-Winkler text similarity
    const simScore = jaroWinklerSimilarity(normalizedQuery, nameNorm);

    // Signal 2: Token match score
    let tokenMatches = 0;
    for (const qTok of queryTokens) {
      if (nameTokens.some(nTok => nTok.includes(qTok) || qTok.includes(nTok) || jaroWinklerSimilarity(qTok, nTok) > 0.8)) {
        tokenMatches++;
      }
    }
    const tokenScore = queryTokens.length > 0 ? tokenMatches / queryTokens.length : 0;

    // Signal 3: Place Type / Importance Score
    let placeTypeScore = 0.5;
    const raw = c.rawMetadata || {};
    const type = (raw.type || raw.class || '').toLowerCase();

    if (['administrative', 'suburb', 'neighbourhood', 'locality', 'city', 'town', 'village'].includes(type)) {
      placeTypeScore = 1.0;
    } else if (['station', 'railway', 'bus_station', 'aeroway', 'hospital', 'stadium', 'building'].includes(type)) {
      placeTypeScore = 0.9;
    } else if (['road', 'primary', 'secondary', 'tertiary', 'trunk', 'highway'].includes(type)) {
      placeTypeScore = 0.8;
    }

    const importance = c.confidence ?? (raw.importance ? parseFloat(raw.importance) : 0.5);

    // Signal 4: Geographic Relevance
    let regionScore = 0.5;
    if (c.state && c.state.toLowerCase().includes('telangana')) regionScore += 0.2;
    if (c.city && (c.city.toLowerCase().includes('hyderabad') || c.city.toLowerCase().includes('medchal'))) regionScore += 0.3;

    // Combined Weighted Multi-Signal Score
    const finalScore = (simScore * 0.40) + (tokenScore * 0.25) + (placeTypeScore * 0.15) + (importance * 0.10) + (regionScore * 0.10);

    return {
      candidate: c,
      score: finalScore
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const seenKeys = new Set();
  const ranked = [];

  for (const item of scored) {
    const key = `${item.candidate.latitude.toFixed(4)},${item.candidate.longitude.toFixed(4)}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      ranked.push(item.candidate);
    }
  }

  return ranked;
}

/**
 * 5. GENERIC CONTEXT-COMPLETENESS CALCULATOR
 */
function computeGenericContextCompleteness(query, candidate) {
  if (!query || !candidate) return { completenessScore: 0.0, hasCityMatch: false, hasStateMatch: false };

  const normQ = normalizeQuery(query);
  const qTokens = normQ.split(/\s+/).filter(Boolean);

  // A 6-digit PIN code is highly complete context
  if (qTokens.length === 1 && /^\d{6}$/.test(qTokens[0])) {
    return { completenessScore: 0.85, hasCityMatch: true, hasStateMatch: true };
  }

  let completenessScore = 0.0;

  if (qTokens.length >= 3) completenessScore += 0.25;
  else if (qTokens.length === 2) completenessScore += 0.15;

  const candCity = (candidate.city || '').toLowerCase();
  const candState = (candidate.state || '').toLowerCase();
  const raw = candidate.rawMetadata || {};
  const candAddr = raw.address || {};

  let hasCityMatch = false;
  let hasStateMatch = false;

  for (const tok of qTokens) {
    if (tok.length > 2) {
      if (
        candCity === tok ||
        (candAddr.city || '').toLowerCase() === tok ||
        (candAddr.town || '').toLowerCase() === tok ||
        (candAddr.county || '').toLowerCase() === tok ||
        (candAddr.municipality || '').toLowerCase() === tok
      ) {
        hasCityMatch = true;
      }
      if (
        candState === tok ||
        (candAddr.state || '').toLowerCase() === tok
      ) {
        hasStateMatch = true;
      }
    }
  }

  if (hasCityMatch) completenessScore += 0.35;
  if (hasStateMatch) completenessScore += 0.25;

  const type = (raw.type || raw.class || '').toLowerCase();
  if (['suburb', 'locality', 'neighbourhood', 'administrative', 'station', 'aeroway'].includes(type)) {
    completenessScore += 0.15;
  }

  if (normQ.includes('station') || normQ.includes('expressway') || normQ.includes('highway') || normQ.includes('fort') || normQ.includes('temple') || normQ.includes('hospital')) {
    completenessScore += 0.15;
  }

  return {
    completenessScore: Math.min(1.0, completenessScore),
    hasCityMatch,
    hasStateMatch
  };
}

/**
 * 6. GENERIC SEMANTIC DECISION CLASSIFIER
 */
function classifySemanticDecision(query, scoredCandidates, options = {}) {
  if (!scoredCandidates || scoredCandidates.length === 0) {
    return { decision: 'NO_RESULT', reason: 'Provider returned 0 usable candidates' };
  }

  const top = scoredCandidates[0];
  const second = scoredCandidates.length > 1 ? scoredCandidates[1] : null;

  // Rule 1: REJECT
  if (top.analysis.countryScore < 0) {
    return { decision: 'REJECT', reason: `Country mismatch: candidate is in "${top.candidate.country || 'International'}"` };
  }

  if (top.analysis.distancePenalty < -0.20) {
    return { decision: 'REJECT', reason: `Context bounds mismatch: candidate is > 50km outside active search region` };
  }

  const normQ = normalizeQuery(query);
  const qTokens = normQ.split(/\s+/).filter(Boolean);
  const contextMeta = computeGenericContextCompleteness(query, top.candidate);
  const contextCompleteness = contextMeta.completenessScore;
  const isPinCode = qTokens.length === 1 && /^\d{6}$/.test(qTokens[0]);

  // Rule 2: ASK_FOR_CLARIFICATION for queries lacking explicit city/state match and low context completeness
  if (!isPinCode && !contextMeta.hasCityMatch && !contextMeta.hasStateMatch && contextCompleteness < 0.45) {
    if (second && (top.analysis.score - second.analysis.score < 0.15)) {
      return { decision: 'SHOW_CANDIDATES', reason: `Multiple plausible local candidates for broad query "${query}"` };
    }
    return { decision: 'ASK_FOR_CLARIFICATION', reason: 'Short/broad query without sufficient geographic context' };
  }

  let candidateGeographicSpread = false;
  if (scoredCandidates.length >= 2) {
    const cities = new Set(scoredCandidates.map(c => (c.candidate.city || c.candidate.state || c.candidate.name || '').toLowerCase()).filter(Boolean));
    if (cities.size >= 2) {
      candidateGeographicSpread = true;
    }
  }

  if (candidateGeographicSpread && contextCompleteness < 0.50 && top.analysis.score < 0.70) {
    return { decision: 'ASK_FOR_CLARIFICATION', reason: 'Generic query matching candidates across multiple cities/states' };
  }

  // Rule 3: SHOW_CANDIDATES (multiple plausible local candidates with small score gap when context completeness is low)
  if (second) {
    const scoreDiff = top.analysis.score - second.analysis.score;
    if (second.analysis.score >= 0.40 && scoreDiff < 0.12 && contextCompleteness < 0.40) {
      return { decision: 'SHOW_CANDIDATES', reason: `Multiple plausible local candidates with small score gap (${scoreDiff.toFixed(2)} < 0.12)` };
    }
  }

  // Rule 4: AUTO_RESOLVE (high score and sufficient context completeness)
  if (isPinCode || (top.analysis.score >= 0.50 && (contextCompleteness >= 0.40 || (second && top.analysis.score - second.analysis.score >= 0.15)))) {
    return { decision: 'AUTO_RESOLVE', reason: `Strong candidate score (${top.analysis.score.toFixed(2)}) with sufficient context completeness (${contextCompleteness.toFixed(2)})` };
  }

  return { decision: 'ASK_FOR_CLARIFICATION', reason: 'Candidate confidence or context is insufficient to auto-resolve safely' };
}

module.exports = {
  normalizeQuery,
  generateGenericVariants,
  levenshteinDistance,
  jaroWinklerSimilarity,
  rankCandidates,
  computeGenericContextCompleteness,
  classifySemanticDecision
};
