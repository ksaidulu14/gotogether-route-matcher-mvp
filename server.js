const express = require("express");
const path = require("path");

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    // Ignored in Vercel/production environments where environment variables are injected natively
  }
}

const supabase = require("./lib/supabase");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

// In-memory route cache for ultra-fast candidate precomputation (complements DB precomputation)
const routeCache = new Map();

function getRouteCacheKey(a, b) {
  return `${a.lat.toFixed(4)},${a.lon.toFixed(4)}->${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
}

/*
==================================================
GEOCODING
==================================================
*/

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    "?format=jsonv2" +
    "&limit=1" +
    "&countrycodes=in" +
    "&q=" +
    encodeURIComponent(query);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "GoTogetherRouteMatcherMVP/0.1 (prototype)"
    }
  });

  if (!response.ok) {
    throw new Error("Geocoding failed: " + response.status);
  }

  const data = await response.json();

  if (!data.length) {
    throw new Error("Location not found: " + query);
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    display: data[0].display_name
  };
}

/*
==================================================
OSRM ROUTING (WITH CACHING & PRECOMPUTATION)
==================================================
*/

async function osrmRoute(a, b) {
  const cacheKey = getRouteCacheKey(a, b);
  if (routeCache.has(cacheKey)) {
    return routeCache.get(cacheKey);
  }

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lon},${a.lat};${b.lon},${b.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Routing failed: " + response.status);
  }

  const data = await response.json();

  if (data.code !== "Ok" || !data.routes || !data.routes.length) {
    throw new Error("No driving route found.");
  }

  const route = data.routes[0];
  routeCache.set(cacheKey, route);
  return route;
}

/*
==================================================
GEOMETRY & SPATIAL HELPERS
==================================================
*/

function rad(x) {
  return (x * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(rad(lat1)) *
      Math.cos(rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

function bearing(a, b) {
  const p1 = rad(a[1]);
  const p2 = rad(b[1]);
  const dl = rad(b[0] - a[0]);

  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dl);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function pointSegDist(p, a, b) {
  const lat0 = rad(p[1]);
  const kx = 111320 * Math.cos(lat0);
  const ky = 110540;

  const px = p[0] * kx;
  const py = p[1] * ky;

  const ax = a[0] * kx;
  const ay = a[1] * ky;

  const bx = b[0] * kx;
  const by = b[1] * ky;

  const dx = bx - ax;
  const dy = by - ay;

  const len2 = dx * dx + dy * dy;

  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));

  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function minRouteDistance(p, line) {
  let best = Infinity;
  for (let i = 1; i < line.length; i++) {
    best = Math.min(best, pointSegDist(p, line[i - 1], line[i]));
  }
  return best;
}

function sample(line, n = 100) {
  if (line.length <= n) {
    return line;
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(line[Math.round((i * (line.length - 1)) / (n - 1))]);
  }
  return out;
}

function corridorShare(lineA, lineB, threshold = 1000) {
  const samples = sample(lineA, 100);
  let near = 0;
  for (const point of samples) {
    if (minRouteDistance(point, lineB) <= threshold) {
      near++;
    }
  }
  return near / samples.length;
}

/*
==================================================
MEETING POINT HELPER
==================================================
*/

function findMeetingPoint(lineA, lineB, threshold = 1000) {
  const samplesA = sample(lineA, 200);
  const samplesB = sample(lineB, 200);
  const candidates = [];

  for (const pointA of samplesA) {
    const distanceToB = minRouteDistance(pointA, lineB);
    if (distanceToB <= threshold) {
      candidates.push({
        point: pointA,
        distance: distanceToB
      });
    }
  }

  for (const pointB of samplesB) {
    const distanceToA = minRouteDistance(pointB, lineA);
    if (distanceToA <= threshold) {
      candidates.push({
        point: pointB,
        distance: distanceToA
      });
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => a.distance - b.distance);
  const best = candidates[0];

  return {
    lon: best.point[0],
    lat: best.point[1],
    distanceToOtherRouteMeters: Math.round(best.distance)
  };
}

/*
==================================================
EXPRESS ROUTER (MOUNTED DUAL FOR VERCEL & LOCAL)
==================================================
*/

const apiRouter = express.Router();

/*
1. CREATE JOURNEY (POST /journeys) - WITH PRECOMPUTATION
*/
apiRouter.post("/journeys", async (req, res) => {
  try {
    const { name, pickup, drop } = req.body || {};

    if (!name || !pickup || !drop) {
      return res.status(400).json({
        error: "Name, pickup and drop are required."
      });
    }

    const pickupGeo = await geocode(pickup);
    await sleep(1100);
    const dropGeo = await geocode(drop);

    // Precompute OSRM Route & Bearing
    let routeGeojson = null;
    let routeDistanceMeters = null;
    let bearingDegrees = null;

    try {
      const route = await osrmRoute(pickupGeo, dropGeo);
      const coords = route.geometry.coordinates;
      routeGeojson = route.geometry;
      routeDistanceMeters = route.distance || 0;
      if (coords && coords.length > 1) {
        bearingDegrees = Math.round(bearing(coords[0], coords[coords.length - 1]) * 100) / 100;
      }
    } catch (routeErr) {
      console.warn("Precomputation warning:", routeErr.message);
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .insert({ name })
      .select()
      .single();

    if (profileError) throw profileError;

    // Attempt to insert with precomputation columns; fallback to base schema if columns absent
    let journeyPayload = {
      user_id: profile.id,
      pickup_name: pickup,
      pickup_lat: pickupGeo.lat,
      pickup_lon: pickupGeo.lon,
      drop_name: drop,
      drop_lat: dropGeo.lat,
      drop_lon: dropGeo.lon,
      status: "active"
    };

    if (routeGeojson && bearingDegrees !== null) {
      journeyPayload.route_geojson = routeGeojson;
      journeyPayload.route_distance_meters = routeDistanceMeters;
      journeyPayload.bearing_degrees = bearingDegrees;
    }

    let journeyResult = await supabase
      .from("journeys")
      .insert(journeyPayload)
      .select()
      .single();

    if (journeyResult.error && journeyResult.error.message.includes("column")) {
      // Column fallback if spatial migration script is not yet applied
      delete journeyPayload.route_geojson;
      delete journeyPayload.route_distance_meters;
      delete journeyPayload.bearing_degrees;
      journeyResult = await supabase
        .from("journeys")
        .insert(journeyPayload)
        .select()
        .single();
    }

    if (journeyResult.error) throw journeyResult.error;

    const journey = journeyResult.data;

    res.json({
      success: true,
      profile,
      journey: {
        id: journey.id,
        user_id: journey.user_id,
        pickup: { name: journey.pickup_name, lat: journey.pickup_lat, lon: journey.pickup_lon },
        drop: { name: journey.drop_name, lat: journey.drop_lat, lon: journey.drop_lon },
        status: journey.status,
        bearing_degrees: bearingDegrees,
        route_distance_km: routeDistanceMeters ? Math.round((routeDistanceMeters / 1000) * 10) / 10 : null
      }
    });
  } catch (error) {
    console.error("Journey creation error:", error);
    res.status(500).json({
      error: error.message || "Could not save your journey."
    });
  }
});

/*
2. LOAD ACTIVE JOURNEYS (GET /journeys) - FOR MAP OVERLAY & BACKWARD COMPATIBILITY
*/
apiRouter.get("/journeys", async (req, res) => {
  try {
    const { searchRadiusKm } = req.query || {};
    const { data, error } = await supabase
      .from("journeys")
      .select(`
        id,
        user_id,
        pickup_name,
        pickup_lat,
        pickup_lon,
        drop_name,
        drop_lat,
        drop_lon,
        status,
        created_at,
        profiles (
          id,
          name
        )
      `)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) throw error;

    res.json({
      success: true,
      searchRadiusKm: Number(searchRadiusKm) || 10,
      journeys: data || []
    });
  } catch (error) {
    console.error("Load journeys error:", error);
    res.status(500).json({
      error: error.message || "Could not load journeys."
    });
  }
});

/*
3. MATCH PAIR JOURNEYS (POST /match) - PRESERVED FOR COMPATIBILITY & DIRECT TESTING
*/
apiRouter.post("/match", async (req, res) => {
  const startTimeNs = process.hrtime.bigint();

  try {
    const {
      aPickup, aDrop, bPickup, bDrop,
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      bPickupLat, bPickupLon, bDropLat, bDropLon,
      searchRadiusKm
    } = req.body || {};

    let aPickupGeo, aDropGeo, bPickupGeo, bDropGeo;

    const coordinatesProvided = [
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      bPickupLat, bPickupLon, bDropLat, bDropLon
    ].every(val => typeof val === "number" || (typeof val === "string" && val !== ""));

    if (coordinatesProvided) {
      aPickupGeo = { lat: Number(aPickupLat), lon: Number(aPickupLon) };
      aDropGeo = { lat: Number(aDropLat), lon: Number(aDropLon) };
      bPickupGeo = { lat: Number(bPickupLat), lon: Number(bPickupLon) };
      bDropGeo = { lat: Number(bDropLat), lon: Number(bDropLon) };
    } else {
      if (![aPickup, aDrop, bPickup, bDrop].every(v => typeof v === "string" && v.trim())) {
        return res.status(400).json({ error: "Please provide all four locations or coordinates." });
      }
      aPickupGeo = await geocode(aPickup);
      await sleep(1100);
      aDropGeo = await geocode(aDrop);
      await sleep(1100);
      bPickupGeo = await geocode(bPickup);
      await sleep(1100);
      bDropGeo = await geocode(bDrop);
    }

    const stage1StartNs = process.hrtime.bigint();

    // Calculate Pickup-to-Pickup Distance
    const pickupDistanceKm = haversineKm(
      aPickupGeo.lat,
      aPickupGeo.lon,
      bPickupGeo.lat,
      bPickupGeo.lon
    );

    const radiusLimit = Number(searchRadiusKm) || 10;
    const isWithinRadius = pickupDistanceKm <= radiusLimit;

    const stage1EndNs = process.hrtime.bigint();
    const candidateRetrievalMs = Number(stage1EndNs - stage1StartNs) / 1e6;

    const stage2StartNs = process.hrtime.bigint();

    // Stage 2: Exact OSRM Route & Corridor Share Math
    const [routeA, routeB] = await Promise.all([
      osrmRoute(aPickupGeo, aDropGeo),
      osrmRoute(bPickupGeo, bDropGeo)
    ]);

    const lineA = routeA.geometry.coordinates;
    const lineB = routeB.geometry.coordinates;

    const shareAB = corridorShare(lineA, lineB, 1000);
    const shareBA = corridorShare(lineB, lineA, 1000);

    const dirA = bearing(lineA[0], lineA[lineA.length - 1]);
    const dirB = bearing(lineB[0], lineB[lineB.length - 1]);

    const directionDifference = angleDiff(dirA, dirB);

    const directionOK = directionDifference <= 55;
    const corridorOK = shareAB >= 0.25 || shareBA >= 0.25 || (shareAB >= 0.20 && shareBA >= 0.20);

    const matched = directionOK && corridorOK;

    const routeOverlap = Math.max(shareAB, shareBA) * 100;
    const directionAlignment = Math.max(0, Math.min(100, (1 - directionDifference / 55) * 100));

    const routeMatchScore = (routeOverlap * 0.60) + (directionAlignment * 0.40);

    const routeMatchPercent = Math.round(routeMatchScore);
    const routeOverlapPercent = Math.round(routeOverlap);
    const directionAlignmentPercent = Math.round(directionAlignment);

    // Calculate Shared Route Distance in Kilometers
    const routeALengthKm = (routeA.distance || 0) / 1000;
    const maxShare = Math.max(shareAB, shareBA);
    const sharedRouteDistanceKm = Math.round(routeALengthKm * maxShare * 10) / 10;

    const meetingPoint = findMeetingPoint(lineA, lineB, 1000);
    const meetingData = meetingPoint
      ? { found: true, meetingPoint }
      : { found: false, meetingPoint: null };

    const stage2EndNs = process.hrtime.bigint();
    const matchingMs = Number(stage2EndNs - stage2StartNs) / 1e6;
    const totalMs = Number(stage2EndNs - startTimeNs) / 1e6;

    res.json({
      matched,
      thresholdMeters: 1000,
      directionDifference,
      shareAB,
      shareBA,
      routeOverlapPercent,
      directionAlignmentPercent,
      routeMatchPercent,
      pickupDistanceKm,
      sharedRouteDistanceKm,
      searchRadiusKm: radiusLimit,
      isWithinRadius,
      meetingData,
      timing: {
        candidateRetrievalMs: Math.round(candidateRetrievalMs * 100) / 100,
        candidateCount: isWithinRadius ? 1 : 0,
        matchingMs: Math.round(matchingMs * 100) / 100,
        totalMs: Math.round(totalMs * 100) / 100
      },
      a: {
        pickup: { lat: aPickupGeo.lat, lon: aPickupGeo.lon, name: aPickup },
        drop: { lat: aDropGeo.lat, lon: aDropGeo.lon, name: aDrop }
      },
      b: {
        pickup: { lat: bPickupGeo.lat, lon: bPickupGeo.lon, name: bPickup },
        drop: { lat: bDropGeo.lat, lon: bDropGeo.lon, name: bDrop }
      },
      routeA: routeA.geometry,
      routeB: routeB.geometry,
      rules: { directionMaxDegrees: 55, minOneWayShare: 0.25, twoWayShare: 0.20 }
    });
  } catch (error) {
    console.error("Matching error:", error);
    res.status(500).json({ error: error.message || "Matching failed." });
  }
});

/*
4. PRODUCTION-SCALE MATCH SEARCH (POST /match-search)
   Single endpoint executing DB spatial candidate filtering + exact route matching on candidates
*/
apiRouter.post("/match-search", async (req, res) => {
  const startTimeNs = process.hrtime.bigint();

  try {
    const {
      aPickup, aDrop,
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      searchRadiusKm
    } = req.body || {};

    let aPickupGeo, aDropGeo;

    const coordinatesProvided = [
      aPickupLat, aPickupLon, aDropLat, aDropLon
    ].every(val => typeof val === "number" || (typeof val === "string" && val !== ""));

    if (coordinatesProvided) {
      aPickupGeo = { lat: Number(aPickupLat), lon: Number(aPickupLon) };
      aDropGeo = { lat: Number(aDropLat), lon: Number(aDropLon) };
    } else {
      if (!aPickup || !aDrop) {
        return res.status(400).json({ error: "Please provide pickup and destination locations or coordinates." });
      }
      aPickupGeo = await geocode(aPickup);
      await sleep(1100);
      aDropGeo = await geocode(aDrop);
    }

    // 1. Fetch User A Route & Calculate Bearing Angle ONCE
    const routeA = await osrmRoute(aPickupGeo, aDropGeo);
    const lineA = routeA.geometry.coordinates;
    const userBearing = bearing(lineA[0], lineA[lineA.length - 1]);
    const radiusLimitKm = Number(searchRadiusKm) || 5;
    const searchRadiusMeters = radiusLimitKm * 1000;

    // 2. Database Spatial Candidate Retrieval
    const candidateRetrievalStartNs = process.hrtime.bigint();
    let candidates = [];
    let isRpcActive = false;

    // Try Supabase RPC 'get_nearby_candidate_journeys' first
    const rpcRes = await supabase.rpc("get_nearby_candidate_journeys", {
      user_lat: aPickupGeo.lat,
      user_lon: aPickupGeo.lon,
      search_radius_meters: searchRadiusMeters,
      user_bearing: userBearing,
      max_bearing_difference: 55
    });

    if (!rpcRes.error && Array.isArray(rpcRes.data)) {
      candidates = rpcRes.data;
      isRpcActive = true;
    } else {
      // Bounding box DB query fallback if PostGIS RPC is not yet executed on remote Supabase
      const latDelta = radiusLimitKm / 111;
      const lonDelta = radiusLimitKm / (111 * Math.cos(rad(aPickupGeo.lat)));

      const { data: dbJourneys, error: dbError } = await supabase
        .from("journeys")
        .select(`
          id, user_id, pickup_name, pickup_lat, pickup_lon,
          drop_name, drop_lat, drop_lon, status, created_at,
          profiles ( id, name )
        `)
        .eq("status", "active")
        .gte("pickup_lat", aPickupGeo.lat - latDelta)
        .lte("pickup_lat", aPickupGeo.lat + latDelta)
        .gte("pickup_lon", aPickupGeo.lon - lonDelta)
        .lte("pickup_lon", aPickupGeo.lon + lonDelta);

      if (!dbError && dbJourneys) {
        candidates = dbJourneys.map(j => ({
          ...j,
          profile_name: j.profiles ? j.profiles.name : "Traveler"
        }));
      }
    }

    const candidateRetrievalEndNs = process.hrtime.bigint();
    const candidateRetrievalMs = Number(candidateRetrievalEndNs - candidateRetrievalStartNs) / 1e6;

    // 3. Exact Matching Loop (Only on Candidates Returned by DB)
    const exactMatchingStartNs = process.hrtime.bigint();
    const matches = [];

    for (const candidate of candidates) {
      try {
        const bPickupGeo = { lat: candidate.pickup_lat, lon: candidate.pickup_lon };
        const bDropGeo = { lat: candidate.drop_lat, lon: candidate.drop_lon };

        let routeB;
        if (candidate.route_geojson) {
          routeB = { geometry: candidate.route_geojson, distance: candidate.route_distance_meters || 0 };
        } else {
          routeB = await osrmRoute(bPickupGeo, bDropGeo);
        }

        const lineB = routeB.geometry.coordinates;

        // Corridor share math
        const shareAB = corridorShare(lineA, lineB, 1000);
        const shareBA = corridorShare(lineB, lineA, 1000);

        // Bearing angle math
        const dirB = candidate.bearing_degrees !== null && candidate.bearing_degrees !== undefined
          ? candidate.bearing_degrees
          : bearing(lineB[0], lineB[lineB.length - 1]);

        const directionDifference = angleDiff(userBearing, dirB);

        // Eligibility Rules - EXACT MATCHING RULES (DO NOT CHANGE)
        const directionOK = directionDifference <= 55;
        const corridorOK = shareAB >= 0.25 || shareBA >= 0.25 || (shareAB >= 0.20 && shareBA >= 0.20);
        const matched = directionOK && corridorOK;

        if (matched) {
          const pickupDistanceKm = haversineKm(
            aPickupGeo.lat, aPickupGeo.lon,
            candidate.pickup_lat, candidate.pickup_lon
          );

          const routeOverlap = Math.max(shareAB, shareBA) * 100;
          const directionAlignment = Math.max(0, Math.min(100, (1 - directionDifference / 55) * 100));
          const routeMatchScore = (routeOverlap * 0.60) + (directionAlignment * 0.40);

          const routeMatchPercent = Math.round(routeMatchScore);
          const routeOverlapPercent = Math.round(routeOverlap);
          const directionAlignmentPercent = Math.round(directionAlignment);

          const routeALengthKm = (routeA.distance || 0) / 1000;
          const sharedRouteDistanceKm = Math.round(routeALengthKm * Math.max(shareAB, shareBA) * 10) / 10;

          // Meeting point calculation - ONLY FOR ELIGIBLE MATCHES
          const meetingPoint = findMeetingPoint(lineA, lineB, 1000);
          const meetingData = meetingPoint
            ? { found: true, meetingPoint }
            : { found: false, meetingPoint: null };

          matches.push({
            id: candidate.id,
            name: candidate.profile_name || "Traveler",
            pickup: candidate.pickup_name,
            drop: candidate.drop_name,
            meetingData,
            data: {
              matched: true,
              thresholdMeters: 1000,
              directionDifference,
              shareAB,
              shareBA,
              routeOverlapPercent,
              directionAlignmentPercent,
              routeMatchPercent,
              pickupDistanceKm,
              sharedRouteDistanceKm,
              searchRadiusKm: radiusLimitKm,
              meetingData,
              a: {
                pickup: { lat: aPickupGeo.lat, lon: aPickupGeo.lon, name: aPickup },
                drop: { lat: aDropGeo.lat, lon: aDropGeo.lon, name: aDrop }
              },
              b: {
                pickup: { lat: candidate.pickup_lat, lon: candidate.pickup_lon, name: candidate.pickup_name },
                drop: { lat: candidate.drop_lat, lon: candidate.drop_lon, name: candidate.drop_name }
              },
              routeA: routeA.geometry,
              routeB: routeB.geometry,
              rules: { directionMaxDegrees: 55, minOneWayShare: 0.25, twoWayShare: 0.20 }
            }
          });
        }
      } catch (err) {
        console.error("Candidate match evaluation error:", err.message);
      }
    }

    // Sort matches descending by routeMatchPercent
    matches.sort((a, b) => (b.data.routeMatchPercent || 0) - (a.data.routeMatchPercent || 0));

    const exactMatchingEndNs = process.hrtime.bigint();
    const exactMatchingMs = Number(exactMatchingEndNs - exactMatchingStartNs) / 1e6;
    const totalMs = Number(exactMatchingEndNs - startTimeNs) / 1e6;

    res.json({
      success: true,
      matches,
      matchCount: matches.length,
      candidateCount: candidates.length,
      searchRadiusKm: radiusLimitKm,
      timing: {
        candidateRetrievalMs: Math.round(candidateRetrievalMs * 100) / 100,
        exactMatchingMs: Math.round(exactMatchingMs * 100) / 100,
        totalMs: Math.round(totalMs * 100) / 100,
        candidateCount: candidates.length,
        matchCount: matches.length,
        databaseSpatialFilterActive: isRpcActive
      }
    });

  } catch (error) {
    console.error("Match search error:", error);
    res.status(500).json({ error: error.message || "Match search failed." });
  }
});

/*
5. MEETING POINT (POST /meeting-point)
*/
apiRouter.post("/meeting-point", async (req, res) => {
  try {
    const {
      aPickup, aDrop, bPickup, bDrop,
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      bPickupLat, bPickupLon, bDropLat, bDropLon
    } = req.body || {};

    let aPickupGeo, aDropGeo, bPickupGeo, bDropGeo;

    const coordinatesProvided = [
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      bPickupLat, bPickupLon, bDropLat, bDropLon
    ].every(val => typeof val === "number" || (typeof val === "string" && val !== ""));

    if (coordinatesProvided) {
      aPickupGeo = { lat: Number(aPickupLat), lon: Number(aPickupLon) };
      aDropGeo = { lat: Number(aDropLat), lon: Number(aDropLon) };
      bPickupGeo = { lat: Number(bPickupLat), lon: Number(bPickupLon) };
      bDropGeo = { lat: Number(bDropLat), lon: Number(bDropLon) };
    } else {
      if (![aPickup, aDrop, bPickup, bDrop].every(v => typeof v === "string" && v.trim())) {
        return res.status(400).json({ error: "Please provide all four locations or coordinates." });
      }
      aPickupGeo = await geocode(aPickup);
      await sleep(1100);
      aDropGeo = await geocode(aDrop);
      await sleep(1100);
      bPickupGeo = await geocode(bPickup);
      await sleep(1100);
      bDropGeo = await geocode(bDrop);
    }

    const [routeA, routeB] = await Promise.all([
      osrmRoute(aPickupGeo, aDropGeo),
      osrmRoute(bPickupGeo, bDropGeo)
    ]);

    const lineA = routeA.geometry.coordinates;
    const lineB = routeB.geometry.coordinates;

    const meetingPoint = findMeetingPoint(lineA, lineB, 1000);

    if (!meetingPoint) {
      return res.json({ found: false, meetingPoint: null });
    }

    res.json({ found: true, meetingPoint });
  } catch (error) {
    console.error("Meeting point error:", error);
    res.status(500).json({ error: error.message || "Could not find meeting point." });
  }
});

/*
MOUNT ROUTER ON BOTH /api AND / FOR VERCEL SERVERLESS REWRITE COMPATIBILITY
*/
app.use("/api", apiRouter);
app.use("/", apiRouter);

/*
FRONTEND FALLBACK FOR LOCAL DEV / NON-API REQUESTS
*/
app.use((req, res) => {
  res.sendFile(
    path.join(__dirname, "public", "index.html"),
    (err) => {
      if (err && !res.headersSent) {
        res.status(404).send("Not Found");
      }
    }
  );
});

/*
==================================================
EXPORT APP & START SERVER FOR LOCAL DEV
==================================================
*/

module.exports = app;

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`GoTogether Route Matcher running at http://localhost:${PORT}`);
  });
}