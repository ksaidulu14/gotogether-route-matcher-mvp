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

// In-memory fallback stores for high resilience
const routeCache = new Map();
const inMemoryJoinRequests = [];
const inMemoryConversations = [];
const inMemoryMessages = [];
const inMemoryNotifications = [];

const APPROVED_QUICK_MESSAGES = {
  "where_meet": "Where should we meet?",
  "near_metro": "Can we meet near the metro?",
  "around_time": "I'll be there around the departure time.",
  "ready_leave": "I'm ready to leave.",
  "thanks_see_you": "Thanks, see you there."
};

const SEED_JOURNEYS = [
  {
    id: "j-seed-1",
    user_id: "u-seed-1",
    pickup_name: "Nagole",
    pickup_lat: 17.3775306,
    pickup_lon: 78.5601231,
    drop_name: "Ghatkesar",
    drop_lat: 17.4510837,
    drop_lon: 78.6843022,
    departure_date: new Date().toISOString().split('T')[0],
    departure_time: "08:30:00",
    status: "active",
    created_at: new Date().toISOString(),
    profiles: { id: "u-seed-1", name: "Rahul (Commuter)" }
  },
  {
    id: "j-seed-2",
    user_id: "u-seed-2",
    pickup_name: "Uppal X Road",
    pickup_lat: 17.4025091,
    pickup_lon: 78.5612562,
    drop_name: "Ghatkesar",
    drop_lat: 17.4510837,
    drop_lon: 78.6843022,
    departure_date: new Date().toISOString().split('T')[0],
    departure_time: "08:45:00",
    status: "active",
    created_at: new Date().toISOString(),
    profiles: { id: "u-seed-2", name: "Priya S." }
  },
  {
    id: "j-seed-3",
    user_id: "u-seed-3",
    pickup_name: "Boduppal",
    pickup_lat: 17.4128,
    pickup_lon: 78.5783,
    drop_name: "Ghatkesar",
    drop_lat: 17.4510837,
    drop_lon: 78.6843022,
    departure_date: new Date().toISOString().split('T')[0],
    departure_time: "08:30:00",
    status: "active",
    created_at: new Date().toISOString(),
    profiles: { id: "u-seed-3", name: "Suresh Kumar" }
  },
  {
    id: "j-seed-4",
    user_id: "u-seed-4",
    pickup_name: "Uppal Depot",
    pickup_lat: 17.3980,
    pickup_lon: 78.5580,
    drop_name: "HITEC City",
    drop_lat: 17.4435,
    drop_lon: 78.3772,
    departure_date: new Date().toISOString().split('T')[0],
    departure_time: "09:00:00",
    status: "active",
    created_at: new Date().toISOString(),
    profiles: { id: "u-seed-4", name: "Ananya R." }
  }
];

const inMemoryJourneys = process.env.NODE_ENV === "test" ? [...SEED_JOURNEYS] : [];
const SESSION_CUTOFF_TIMESTAMP = new Date("2026-09-25T16:30:00.000Z").getTime();

async function sendNotification({ userId, title, message, type, referenceId }) {
  if (!userId) return null;
  const notifPayload = {
    user_id: userId,
    title,
    message,
    type: type || "general",
    reference_id: referenceId ? String(referenceId) : null,
    created_at: new Date().toISOString()
  };
  let notif = null;
  try {
    const { data, error } = await supabase
      .from("notifications")
      .insert(notifPayload)
      .select()
      .single();
    if (!error && data) notif = data;
  } catch (e) {}

  if (!notif) {
    notif = {
      id: `notif-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      ...notifPayload,
      read_at: null
    };
  }
  inMemoryNotifications.unshift(notif);
  return notif;
}

function getRouteCacheKey(a, b) {
  return `${a.lat.toFixed(4)},${a.lon.toFixed(4)}->${b.lat.toFixed(4)},${b.lon.toFixed(4)}`;
}

/*
==================================================
GEOCODING
==================================================
*/

async function geocode(query) {
  if (!query || typeof query !== "string") {
    return { lat: 17.3850, lon: 78.4867, display: "Hyderabad" };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3500);

    const url =
      "https://nominatim.openstreetmap.org/search" +
      "?format=jsonv2" +
      "&limit=1" +
      "&countrycodes=in" +
      "&q=" +
      encodeURIComponent(query);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "GoTogetherRides/1.0"
      }
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.length) {
        return {
          lat: Number(data[0].lat),
          lon: Number(data[0].lon),
          display: data[0].display_name
        };
      }
    }
  } catch (err) {
    console.warn("Geocoding fetch warning:", err.message);
  }

  return {
    lat: 17.3850,
    lon: 78.4867,
    display: query
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

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

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
  } catch (err) {
    console.warn("OSRM routing warning:", err.message);
    const fallbackRoute = {
      geometry: {
        type: "LineString",
        coordinates: [[a.lon, a.lat], [b.lon, b.lat]]
      },
      distance: Math.round(haversineKm(a.lat, a.lon, b.lat, b.lon) * 1000)
    };
    return fallbackRoute;
  }
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

function interpolatePolyline(line, maxStepMeters = 150) {
  if (!line || line.length === 0) return [];
  const out = [line[0]];
  for (let i = 0; i < line.length - 1; i++) {
    const p1 = line[i];
    const p2 = line[i + 1];
    const distKm = haversineKm(p1[1], p1[0], p2[1], p2[0]);
    const steps = Math.ceil((distKm * 1000) / maxStepMeters);
    for (let s = 1; s <= steps; s++) {
      const frac = s / steps;
      out.push([
        p1[0] + (p2[0] - p1[0]) * frac,
        p1[1] + (p2[1] - p1[1]) * frac
      ]);
    }
  }
  return out;
}

function calculateSharedCorridorDirection(lineA, lineB, threshold = 1000) {
  const overallDirA = bearing(lineA[0], lineA[lineA.length - 1]);
  const overallDirB = bearing(lineB[0], lineB[lineB.length - 1]);
  const overallDiff = angleDiff(overallDirA, overallDirB);

  const denseA = interpolatePolyline(lineA, 150);
  const denseB = interpolatePolyline(lineB, 150);

  if (denseA.length < 2 || denseB.length < 2) {
    return {
      directionDifference: Math.round(overallDiff * 10) / 10,
      directionOK: overallDiff <= 55,
      isOppositeFlow: overallDiff > 90,
      sharedSegmentsCount: 0
    };
  }

  const sharedPairs = [];

  for (let i = 0; i < denseA.length - 1; i++) {
    const pA1 = denseA[i];
    const pA2 = denseA[i + 1];
    const midA = [(pA1[0] + pA2[0]) / 2, (pA1[1] + pA2[1]) / 2];

    if (minRouteDistance(midA, denseB) <= threshold) {
      const bA = bearing(pA1, pA2);

      let closestBSeg = null;
      let minD = Infinity;

      for (let j = 0; j < denseB.length - 1; j++) {
        const pB1 = denseB[j];
        const pB2 = denseB[j + 1];
        const d = pointSegDist(midA, pB1, pB2);
        if (d < minD) {
          minD = d;
          closestBSeg = { bB: bearing(pB1, pB2) };
        }
      }

      if (closestBSeg && minD <= threshold) {
        const diff = angleDiff(bA, closestBSeg.bB);
        sharedPairs.push(diff);
      }
    }
  }

  if (sharedPairs.length === 0) {
    return {
      directionDifference: Math.round(overallDiff * 10) / 10,
      directionOK: overallDiff <= 55,
      isOppositeFlow: overallDiff > 90,
      sharedSegmentsCount: 0
    };
  }

  let totalDiff = 0;
  let oppositeCount = 0;

  for (const diff of sharedPairs) {
    totalDiff += diff;
    if (diff > 90) {
      oppositeCount++;
    }
  }

  const avgSharedDiff = totalDiff / sharedPairs.length;
  const isOppositeFlow = (oppositeCount / sharedPairs.length) >= 0.40;
  const directionOK = (avgSharedDiff <= 55) && !isOppositeFlow;

  return {
    directionDifference: Math.round(avgSharedDiff * 10) / 10,
    directionOK,
    isOppositeFlow,
    sharedSegmentsCount: sharedPairs.length
  };
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

function calculatePartialRideDetails(lineA, lineB, thresholdMeters = 1000) {
  const lineACoords = lineA.coordinates || lineA;
  const lineBCoords = lineB.coordinates || lineB;
  const sharedIndices = [];

  for (let i = 0; i < lineACoords.length; i++) {
    const dist = minRouteDistance(lineACoords[i], lineBCoords);
    if (dist <= thresholdMeters) {
      sharedIndices.push(i);
    }
  }

  if (!sharedIndices.length) {
    return {
      hasSharedSection: false,
      sharedDistanceKm: 0,
      sharedStartCoord: null,
      sharedEndCoord: null,
      sharedLineGeojson: null
    };
  }

  const startIdx = sharedIndices[0];
  const endIdx = sharedIndices[sharedIndices.length - 1];
  const sharedCoords = lineACoords.slice(startIdx, endIdx + 1);

  let distMeters = 0;
  for (let i = 1; i < sharedCoords.length; i++) {
    const p1 = sharedCoords[i - 1];
    const p2 = sharedCoords[i];
    distMeters += haversineKm(p1[1], p1[0], p2[1], p2[0]) * 1000;
  }

  return {
    hasSharedSection: true,
    sharedDistanceKm: Math.round((distMeters / 1000) * 10) / 10,
    sharedStartCoord: { lon: sharedCoords[0][0], lat: sharedCoords[0][1] },
    sharedEndCoord: { lon: sharedCoords[sharedCoords.length - 1][0], lat: sharedCoords[sharedCoords.length - 1][1] },
    sharedLineGeojson: {
      type: "LineString",
      coordinates: sharedCoords
    }
  };
}

/*
==================================================
HUMAN LOCATION & MEETING POINT HELPERS
==================================================
*/

const meetingPointCache = new Map();

function cleanLocationDisplay(fullString) {
  if (!fullString) return "";
  let s = String(fullString).trim();
  // Filter out raw Nominatim technical details, postal codes, or Ward prefixes
  const parts = s.split(',').map(p => p.trim()).filter(Boolean);
  if (!parts.length) return s;

  const filtered = parts
    .map(p => p.replace(/^Ward\s+\d+\s*/i, '').trim())
    .filter(p => 
      Boolean(p) &&
      !/^\d{5,6}$/.test(p) && 
      !/^(India|Telangana|Andhra Pradesh)$/i.test(p) &&
      !/^(District|Mandal|State)$/i.test(p)
    );

  if (filtered.length >= 2) {
    return `${filtered[0]}, ${filtered[1]}`;
  } else if (filtered.length === 1) {
    return filtered[0];
  }
  return parts[0].replace(/^Ward\s+\d+\s*/i, '').trim() || parts[0];
}

async function getHumanReadableMeetingPoint(lat, lon, fallbackLocality) {
  if (!lat || !lon) {
    const loc = cleanLocationDisplay(fallbackLocality);
    return loc ? `Meet around ${loc}` : "Meet near pickup route";
  }
  
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  if (meetingPointCache.has(key)) {
    return meetingPointCache.get(key);
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}&addressdetails=1`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "GoTogetherRides/1.0" }
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      if (data && data.address) {
        const addr = data.address;
        const place = addr.suburb || addr.neighbourhood || addr.quarter || addr.amenity || addr.road || addr.railway || addr.bus_stop;
        const city = addr.city || addr.town || addr.village || addr.city_district;
        
        let display = "";
        if (place) {
          display = `Meet near ${place}`;
        } else if (city) {
          display = `Meet around ${city}`;
        }
        
        if (display) {
          meetingPointCache.set(key, display);
          return display;
        }
      }
    }
  } catch (e) {
    // Ignore network timeouts for meeting point geocoding
  }

  const cleanLoc = cleanLocationDisplay(fallbackLocality);
  const defaultDisplay = cleanLoc ? `Meet around ${cleanLoc}` : "Meet near pickup route";
  meetingPointCache.set(key, defaultDisplay);
  return defaultDisplay;
}

/*
==================================================
EXPRESS ROUTER (MOUNTED DUAL FOR VERCEL & LOCAL)
==================================================
*/

const apiRouter = express.Router();

/*
1. CREATE JOURNEY (POST /journeys) - WITH SCHEDULE & PRECOMPUTATION
*/
apiRouter.post("/journeys", async (req, res) => {
  try {
    const {
      name, pickup, drop, departureDate, departureTime,
      pickupLat, pickupLon, dropLat, dropLon
    } = req.body || {};

    if (!name || !pickup || !drop) {
      return res.status(400).json({
        error: "Name, pickup and drop are required."
      });
    }

    let pickupGeo, dropGeo;

    if (pickupLat && pickupLon && !isNaN(Number(pickupLat)) && !isNaN(Number(pickupLon))) {
      pickupGeo = { lat: Number(pickupLat), lon: Number(pickupLon), display: pickup };
    } else {
      pickupGeo = await geocode(pickup);
    }

    if (dropLat && dropLon && !isNaN(Number(dropLat)) && !isNaN(Number(dropLon))) {
      dropGeo = { lat: Number(dropLat), lon: Number(dropLon), display: drop };
    } else {
      if (!pickupLat || !pickupLon) await sleep(500);
      dropGeo = await geocode(drop);
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const defaultTimeStr = '08:30:00';
    const targetDate = departureDate || todayStr;
    const targetTime = departureTime ? (departureTime.length === 5 ? `${departureTime}:00` : departureTime) : defaultTimeStr;

    // DUPLICATE JOURNEY PREVENTION: Reuse existing active journey for the SAME authenticated user ID if details match
    const userId = req.body.userId;
    const existingInMemory = userId ? inMemoryJourneys.find(j => 
      j.status === "active" &&
      !j.id.startsWith("j-seed-") &&
      j.user_id === userId &&
      j.pickup_name?.toLowerCase() === pickup.toLowerCase() &&
      j.drop_name?.toLowerCase() === drop.toLowerCase() &&
      (j.departure_date === targetDate || !j.departure_date)
    ) : null;

    if (existingInMemory) {
      return res.json({
        success: true,
        reused: true,
        profile: existingInMemory.profiles || { id: existingInMemory.user_id, name },
        journey: {
          id: existingInMemory.id,
          user_id: existingInMemory.user_id,
          pickup: { name: existingInMemory.pickup_name || pickup, lat: existingInMemory.pickup_lat, lon: existingInMemory.pickup_lon },
          drop: { name: existingInMemory.drop_name || drop, lat: existingInMemory.drop_lat, lon: existingInMemory.drop_lon },
          departure_date: existingInMemory.departure_date || targetDate,
          departure_time: existingInMemory.departure_time || targetTime,
          status: existingInMemory.status,
          bearing_degrees: existingInMemory.bearing_degrees || null,
          route_distance_km: existingInMemory.route_distance_meters ? Math.round((existingInMemory.route_distance_meters / 1000) * 10) / 10 : null
        }
      });
    }

    try {
      if (userId) {
        let queryRes = await supabase
          .from("journeys")
          .select(`
            id, user_id, pickup_name, pickup_lat, pickup_lon, drop_name, drop_lat, drop_lon,
            departure_date, departure_time, status, bearing_degrees, route_distance_meters,
            profiles ( id, name )
          `)
          .eq("status", "active")
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (queryRes.error && queryRes.error.message.includes("column")) {
          queryRes = await supabase
            .from("journeys")
            .select(`
              id, user_id, pickup_name, pickup_lat, pickup_lon, drop_name, drop_lat, drop_lon,
              status, profiles ( id, name )
            `)
            .eq("status", "active")
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
        }

        if (!queryRes.error && Array.isArray(queryRes.data)) {
          const match = queryRes.data.find(j => {
            const pickupMatch = j.pickup_name?.toLowerCase() === pickup.toLowerCase() ||
              haversineKm(j.pickup_lat, j.pickup_lon, pickupGeo.lat, pickupGeo.lon) <= 0.5;
            const dropMatch = j.drop_name?.toLowerCase() === drop.toLowerCase() ||
              haversineKm(j.drop_lat, j.drop_lon, dropGeo.lat, dropGeo.lon) <= 0.5;
            const dateMatch = !j.departure_date || j.departure_date === targetDate;
            return pickupMatch && dropMatch && dateMatch;
          });

          if (match) {
            const reusedJ = {
              ...match,
              id: match.id,
              user_id: userId,
              departure_date: match.departure_date || targetDate,
              departure_time: match.departure_time || targetTime,
              profiles: (Array.isArray(match.profiles) ? match.profiles[0] : match.profiles) || { id: userId, name }
            };
            if (!inMemoryJourneys.some(j => j.id === match.id)) {
              inMemoryJourneys.unshift(reusedJ);
            }

            return res.json({
              success: true,
              reused: true,
              profile: reusedJ.profiles,
              journey: {
                id: match.id,
                user_id: reusedJ.user_id,
                pickup: { name: match.pickup_name || pickup, lat: match.pickup_lat, lon: match.pickup_lon },
                drop: { name: match.drop_name || drop, lat: match.drop_lat, lon: match.drop_lon },
                departure_date: match.departure_date || targetDate,
                departure_time: match.departure_time || targetTime,
                status: match.status,
                bearing_degrees: match.bearing_degrees || null,
                route_distance_km: match.route_distance_meters ? Math.round((match.route_distance_meters / 1000) * 10) / 10 : null
              }
            });
          }
        }
      }
    } catch (e) {
      console.warn("Supabase check existing journey warning:", e.message);
    }

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

    let profile = null;
    let profileId = null;

    try {
      const profilePayload = { name };
      if (req.body.userId) {
        profilePayload.id = req.body.userId;
      }
      const { data: dbProfile, error: profileError } = await supabase
        .from("profiles")
        .insert(profilePayload)
        .select()
        .single();
      if (!profileError && dbProfile) {
        profile = dbProfile;
        profileId = req.body.userId || dbProfile.id;
      }
    } catch (e) {
      console.warn("Supabase profile insert fallback:", e.message);
    }

    if (!profile) {
      profileId = req.body.userId || ("u-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7));
      profile = { id: profileId, name };
    }

    const targetDepartureDate = departureDate || todayStr;
    const targetDepartureTime = departureTime ? (departureTime.length === 5 ? `${departureTime}:00` : departureTime) : defaultTimeStr;

    let journeyPayload = {
      user_id: profileId,
      pickup_name: pickup,
      pickup_lat: pickupGeo.lat,
      pickup_lon: pickupGeo.lon,
      drop_name: drop,
      drop_lat: dropGeo.lat,
      drop_lon: dropGeo.lon,
      departure_date: targetDepartureDate,
      departure_time: targetDepartureTime,
      status: "active"
    };

    if (routeGeojson && bearingDegrees !== null) {
      journeyPayload.route_geojson = routeGeojson;
      journeyPayload.route_distance_meters = routeDistanceMeters;
      journeyPayload.bearing_degrees = bearingDegrees;
    }

    let journey = null;
    const isTestMode = process.env.NODE_ENV === "test" || req.headers["x-test-mode"] === "true" || req.body.isTest === true;

    if (!isTestMode) {
      try {
        let journeyResult = await supabase
          .from("journeys")
          .insert(journeyPayload)
          .select()
          .single();

        if (journeyResult && journeyResult.error && journeyResult.error.message.includes("column")) {
          const dbPayload = { ...journeyPayload };
          delete dbPayload.route_geojson;
          delete dbPayload.route_distance_meters;
          delete dbPayload.bearing_degrees;
          delete dbPayload.departure_date;
          delete dbPayload.departure_time;

          journeyResult = await supabase
            .from("journeys")
            .insert(dbPayload)
            .select()
            .single();
        }

        if (journeyResult && !journeyResult.error && journeyResult.data) {
          journey = {
            ...journeyResult.data,
            departure_date: journeyResult.data.departure_date || targetDepartureDate,
            departure_time: journeyResult.data.departure_time || targetDepartureTime,
            user_id: req.body.userId || profileId || journeyResult.data.user_id,
            original_user_id: req.body.userId || profileId,
            profiles: profile
          };
          inMemoryJourneys.unshift(journey);
        }
      } catch (e) {
        console.warn("Supabase journey insert fallback:", e.message);
      }
    }

    if (!journey) {
      const journeyId = "j-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
      journey = {
        id: journeyId,
        ...journeyPayload,
        created_at: new Date().toISOString(),
        profiles: profile
      };
      inMemoryJourneys.unshift(journey);
    }

    const verifyStore = inMemoryJourneys.find(j => j.id === journey.id);
    console.log("POST /api/journeys");
    console.log("userId =", journey.user_id);
    console.log("journeyId =", journey.id);
    console.log("name =", profile.name || name);
    console.log("pickup =", journey.pickup_name || pickup);
    console.log("drop =", journey.drop_name || drop);
    console.log("coordinates =", { pickupLat: journey.pickup_lat, pickupLon: journey.pickup_lon, dropLat: journey.drop_lat, dropLon: journey.drop_lon });
    console.log("JOURNEY STORE VERIFICATION:", verifyStore ? "PROVED (FOUND IN STORE)" : "NOT FOUND IN STORE");

    res.json({
      success: true,
      profile,
      journey: {
        id: journey.id,
        user_id: journey.user_id,
        pickup: { name: journey.pickup_name || pickup, lat: journey.pickup_lat, lon: journey.pickup_lon },
        drop: { name: journey.drop_name || drop, lat: journey.drop_lat, lon: journey.drop_lon },
        departure_date: journey.departure_date || departureDate || todayStr,
        departure_time: journey.departure_time || departureTime || defaultTimeStr,
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
2. LOAD ACTIVE JOURNEYS (GET /journeys)
*/
apiRouter.get("/journeys", async (req, res) => {
  try {
    const { searchRadiusKm } = req.query || {};
    let dbJourneys = [];

    try {
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
          departure_date,
          departure_time,
          status,
          created_at,
          profiles (
            id,
            name
          )
        `)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        dbJourneys = data;
      }
    } catch (e) {
      console.warn("Supabase load journeys fallback:", e.message);
    }

    const combinedMap = new Map();
    inMemoryJourneys.forEach(j => combinedMap.set(j.id, j));
    dbJourneys.forEach(j => combinedMap.set(j.id, j));

    const allowSeeds = req.query.includeSeeds === "true" || process.env.NODE_ENV === "test";
    const filteredJourneys = Array.from(combinedMap.values()).filter(j => {
      if (allowSeeds) return true;
      if (j.id?.startsWith("j-seed-")) return false;
      if (j.created_at && new Date(j.created_at).getTime() < SESSION_CUTOFF_TIMESTAMP) return false;
      return true;
    });

    res.json({
      success: true,
      searchRadiusKm: Number(searchRadiusKm) || 10,
      journeys: filteredJourneys
    });
  } catch (error) {
    console.error("Load journeys error:", error);
    const allowSeeds = req.query.includeSeeds === "true" || process.env.NODE_ENV === "test";
    res.json({
      success: true,
      searchRadiusKm: 10,
      journeys: inMemoryJourneys.filter(j => {
        if (allowSeeds) return true;
        if (j.id?.startsWith("j-seed-")) return false;
        if (j.created_at && new Date(j.created_at).getTime() < SESSION_CUTOFF_TIMESTAMP) return false;
        return true;
      })
    });
  }
});

/*
3. MATCH PAIR JOURNEYS (POST /match)
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

    const [routeA, routeB] = await Promise.all([
      osrmRoute(aPickupGeo, aDropGeo),
      osrmRoute(bPickupGeo, bDropGeo)
    ]);

    const lineA = routeA.geometry.coordinates;
    const lineB = routeB.geometry.coordinates;

    const shareAB = corridorShare(lineA, lineB, 1000);
    const shareBA = corridorShare(lineB, lineA, 1000);

    const sharedDir = calculateSharedCorridorDirection(lineA, lineB, 1000);
    const directionDifference = sharedDir.directionDifference;
    const directionOK = sharedDir.directionOK;
    const corridorOK = shareAB >= 0.25 || shareBA >= 0.25 || (shareAB >= 0.20 && shareBA >= 0.20);

    const matched = directionOK && corridorOK;

    const routeOverlap = Math.max(shareAB, shareBA) * 100;
    const directionAlignment = Math.max(0, Math.min(100, (1 - directionDifference / 55) * 100));

    const routeMatchScore = (routeOverlap * 0.60) + (directionAlignment * 0.40);

    const routeMatchPercent = Math.round(routeMatchScore);
    const routeOverlapPercent = Math.round(routeOverlap);
    const directionAlignmentPercent = Math.round(directionAlignment);

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
4. PRODUCTION MATCH SEARCH (POST /match-search) - WITH SCHEDULE FILTERING
*/
apiRouter.post("/match-search", async (req, res) => {
  const startTimeNs = process.hrtime.bigint();

  try {
    const {
      aPickup, aDrop,
      aPickupLat, aPickupLon, aDropLat, aDropLon,
      searchRadiusKm, departureDate, departureTime,
      requesterJourneyId, requesterUserId, requesterName
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

    const routeA = await osrmRoute(aPickupGeo, aDropGeo);
    const lineA = routeA.geometry.coordinates;
    const userBearing = bearing(lineA[0], lineA[lineA.length - 1]);
    const radiusLimitKm = Number(searchRadiusKm) || 5;
    const searchRadiusMeters = radiusLimitKm * 1000;

    // Dynamically derive route-based geographic candidate search area from User A's road route polyline
    let routeMinLat = aPickupGeo.lat;
    let routeMaxLat = aPickupGeo.lat;
    let routeMinLon = aPickupGeo.lon;
    let routeMaxLon = aPickupGeo.lon;

    if (Array.isArray(lineA) && lineA.length > 0) {
      for (const pt of lineA) {
        const lon = Number(pt[0]);
        const lat = Number(pt[1]);
        if (!isNaN(lat) && !isNaN(lon)) {
          if (lat < routeMinLat) routeMinLat = lat;
          if (lat > routeMaxLat) routeMaxLat = lat;
          if (lon < routeMinLon) routeMinLon = lon;
          if (lon > routeMaxLon) routeMaxLon = lon;
        }
      }
    }

    const latDelta = radiusLimitKm / 111;
    const centerLat = (routeMinLat + routeMaxLat) / 2;
    const lonDelta = radiusLimitKm / (111 * Math.max(0.1, Math.cos(rad(centerLat))));

    const searchMinLat = routeMinLat - latDelta;
    const searchMaxLat = routeMaxLat + latDelta;
    const searchMinLon = routeMinLon - lonDelta;
    const searchMaxLon = routeMaxLon + lonDelta;

    const candidateRetrievalStartNs = process.hrtime.bigint();
    let candidates = [];
    let isRpcActive = false;

    // Try Supabase RPC first
    try {
      const rpcRes = await supabase.rpc("get_nearby_candidate_journeys", {
        user_lat: aPickupGeo.lat,
        user_lon: aPickupGeo.lon,
        search_radius_meters: searchRadiusMeters,
        user_bearing: userBearing,
        max_bearing_difference: 55,
        target_date: null,
        min_lat: searchMinLat,
        max_lat: searchMaxLat,
        min_lon: searchMinLon,
        max_lon: searchMaxLon
      });

      if (!rpcRes.error && Array.isArray(rpcRes.data) && rpcRes.data.length > 0) {
        candidates = rpcRes.data;
        isRpcActive = true;
      }
    } catch (rpcErr) {
      console.warn("RPC candidate retrieval warning:", rpcErr.message);
    }

    if (!isRpcActive) {
      let dbJourneys = [];
      try {
        const { data, error } = await supabase
          .from("journeys")
          .select(`
            id, user_id, pickup_name, pickup_lat, pickup_lon,
            drop_name, drop_lat, drop_lon, status, created_at,
            profiles ( id, name )
          `)
          .eq("status", "active")
          .gte("pickup_lat", searchMinLat)
          .lte("pickup_lat", searchMaxLat)
          .gte("pickup_lon", searchMinLon)
          .lte("pickup_lon", searchMaxLon);

        if (!error && Array.isArray(data)) {
          dbJourneys = data;
        }
      } catch (dbErr) {
        console.warn("DB candidate query warning:", dbErr.message);
      }

      // Merge Supabase DB journeys with route-filtered inMemoryJourneys
      const candidateMap = new Map();
      const filteredInMemory = inMemoryJourneys.filter(j => {
        const lat = Number(j.pickup_lat);
        const lon = Number(j.pickup_lon);
        if (isNaN(lat) || isNaN(lon)) return true;
        return lat >= searchMinLat && lat <= searchMaxLat && lon >= searchMinLon && lon <= searchMaxLon;
      });

      filteredInMemory.forEach(j => candidateMap.set(j.id, j));
      dbJourneys.forEach(j => candidateMap.set(j.id, j));

      candidates = Array.from(candidateMap.values()).map(j => ({
        id: j.id,
        user_id: j.user_id,
        profile_name: (j.profiles && j.profiles.name) || "Traveler",
        pickup_name: j.pickup_name,
        pickup_lat: Number(j.pickup_lat),
        pickup_lon: Number(j.pickup_lon),
        drop_name: j.drop_name,
        drop_lat: Number(j.drop_lat),
        drop_lon: Number(j.drop_lon),
        departure_date: j.departure_date,
        departure_time: j.departure_time,
        status: j.status,
        route_geojson: j.route_geojson || null,
        route_distance_meters: j.route_distance_meters || null,
        bearing_degrees: j.bearing_degrees || null
      }));
    }

    console.log("candidate retrieval:", {
      candidatesFound: candidates.length,
      retrievalRadiusKm: radiusLimitKm,
      routeBasedExpansionUsed: true
    });

    console.log("\n==========================================");
    console.log("MATCH SEARCH REQUEST");
    console.log("- userId:", requesterUserId || "none");
    console.log("- journeyId if present:", requesterJourneyId || "none");
    console.log("- pickup:", aPickup);
    console.log("- drop:", aDrop);
    console.log("- coordinates:", { aPickupLat, aPickupLon, aDropLat, aDropLon });

    // EXCLUDE CURRENT USER'S OWN JOURNEY, IDENTICAL PROFILE SEARCH, OR MOCK SEEDS IN PRODUCTION
    const allowSeeds = req.body.includeSeeds === true || process.env.NODE_ENV === "test";
    candidates = candidates.filter(candidate => {
      if (!allowSeeds && candidate.id && candidate.id.startsWith("j-seed-")) return false;
      if (!allowSeeds && candidate.created_at && new Date(candidate.created_at).getTime() < SESSION_CUTOFF_TIMESTAMP) return false;
      if (requesterJourneyId && candidate.id === requesterJourneyId) return false;
      if (requesterUserId && candidate.user_id === requesterUserId) return false;
      if (requesterName && candidate.profile_name?.toLowerCase() === requesterName.toLowerCase() &&
          candidate.pickup_name?.toLowerCase() === aPickup.toLowerCase() &&
          candidate.drop_name?.toLowerCase() === aDrop.toLowerCase()) {
        return false;
      }
      return true;
    });

    console.log("\nMATCH SEARCH DATABASE CANDIDATES");
    candidates.forEach(c => {
      const isSeed = Boolean(c.id && c.id.startsWith("j-seed-"));
      const sourceOfRecord = isSeed ? "seed" : (isRpcActive ? "DB" : "memory");
      console.log(`- journey_id: ${c.id}`);
      console.log(`  user_id: ${c.user_id}`);
      console.log(`  user name: ${c.profile_name}`);
      console.log(`  pickup: ${c.pickup_name}`);
      console.log(`  drop: ${c.drop_name}`);
      console.log(`  source of record: ${sourceOfRecord}`);
      console.log(`  isSeed: ${isSeed}`);
      console.log(`  active: ${c.status === "active"}`);
    });

    const candidateRetrievalEndNs = process.hrtime.bigint();
    const candidateRetrievalMs = Number(candidateRetrievalEndNs - candidateRetrievalStartNs) / 1e6;

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

        const shareAB = corridorShare(lineA, lineB, 1000);
        const shareBA = corridorShare(lineB, lineA, 1000);

        const sharedDir = calculateSharedCorridorDirection(lineA, lineB, 1000);
        const directionDifference = sharedDir.directionDifference;
        const directionOK = sharedDir.directionOK;
        const corridorOK = shareAB >= 0.25 || shareBA >= 0.25 || (shareAB >= 0.20 && shareBA >= 0.20);
        const matched = directionOK && corridorOK;

        const DESTINATION_THRESHOLD_METERS = 1000;
        const PICKUP_THRESHOLD_METERS = Math.max(1000, radiusLimitKm * 1000);

        const dropDistMeters = Math.round(Math.min(
          minRouteDistance([aDropGeo.lon, aDropGeo.lat], lineB),
          minRouteDistance([bDropGeo.lon, bDropGeo.lat], lineA)
        ));
        const pickupDistMeters = Math.round(Math.min(
          minRouteDistance([aPickupGeo.lon, aPickupGeo.lat], lineB),
          minRouteDistance([bPickupGeo.lon, bPickupGeo.lat], lineA)
        ));

        const servesDestination = dropDistMeters <= DESTINATION_THRESHOLD_METERS;
        const connectsPickup = pickupDistMeters <= PICKUP_THRESHOLD_METERS;

        let matchType = "NEARBY";
        let partialDetails = null;

        if (matched && connectsPickup) {
          if (servesDestination) {
            matchType = "FULL";
          } else {
            const pInfo = calculatePartialRideDetails(lineA, lineB, 1000);
            if (pInfo.hasSharedSection && pInfo.sharedDistanceKm >= 1.0) {
              matchType = "PARTIAL";
              let dropoffLandmark = null;
              if (pInfo.sharedEndCoord) {
                const rawLandmark = await getHumanReadableMeetingPoint(
                  pInfo.sharedEndCoord.lat,
                  pInfo.sharedEndCoord.lon,
                  candidate.drop_name
                );
                dropoffLandmark = rawLandmark
                  .replace(/^Meet near\s*/i, 'Get down near ')
                  .replace(/^Meet around\s*/i, 'Get down near ');
              }
              partialDetails = {
                sharedDistanceKm: pInfo.sharedDistanceKm,
                dropoffLandmark,
                sharedLineGeojson: pInfo.sharedLineGeojson
              };
            }
          }
        }

        if (matchType === "FULL" || matchType === "PARTIAL") {
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
          const sharedRouteDistanceKm = partialDetails
            ? partialDetails.sharedDistanceKm
            : Math.round(routeALengthKm * Math.max(shareAB, shareBA) * 10) / 10;

          const meetingPoint = findMeetingPoint(lineA, lineB, 1000);
          let meetingData = { found: false, meetingPoint: null };
          if (meetingPoint) {
            const fallbackLocality = cleanLocationDisplay(candidate.pickup_name) || cleanLocationDisplay(aPickup);
            const humanDisplay = await getHumanReadableMeetingPoint(meetingPoint.lat, meetingPoint.lon, fallbackLocality);
            meetingData = {
              found: true,
              meetingPoint: {
                lat: meetingPoint.lat,
                lon: meetingPoint.lon,
                distanceToOtherRouteMeters: meetingPoint.distanceToOtherRouteMeters,
                display: humanDisplay
              }
            };
          }

          let scheduleStatus = "same_timing";
          let scheduleDiffers = false;

          if (departureDate && candidate.departure_date && String(candidate.departure_date).split('T')[0] !== String(departureDate).split('T')[0]) {
            scheduleStatus = "different_timing";
            scheduleDiffers = true;
          } else if (departureTime && candidate.departure_time) {
            const [uH, uM] = String(departureTime).split(':').map(Number);
            const [cH, cM] = String(candidate.departure_time).split(':').map(Number);
            if (!isNaN(uH) && !isNaN(cH)) {
              const diffMin = Math.abs((uH * 60 + (uM || 0)) - (cH * 60 + (cM || 0)));
              if (diffMin > 45) {
                scheduleStatus = "different_timing";
                scheduleDiffers = true;
              }
            }
          }

          const isSeed = candidate.id && candidate.id.startsWith("j-seed-");
          const isTest = candidate.profile_name?.toLowerCase().includes("test") || (candidate.id && candidate.id.startsWith("j-178"));

          matches.push({
            id: candidate.id,
            journey_id: candidate.id,
            user_id: candidate.user_id,
            name: candidate.profile_name || "Traveler",
            pickup: cleanLocationDisplay(candidate.pickup_name) || candidate.pickup_name,
            drop: cleanLocationDisplay(candidate.drop_name) || candidate.drop_name,
            departure_date: candidate.departure_date || null,
            departure_time: candidate.departure_time || null,
            matchType,
            servesDestination,
            connectsPickup,
            partialDetails,
            scheduleStatus,
            scheduleDiffers,
            isSeed,
            isTest,
            meetingData,
            data: {
              matched: true,
              matchType,
              servesDestination,
              connectsPickup,
              partialDetails,
              scheduleStatus,
              scheduleDiffers,
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

    matches.sort((a, b) => (b.data.routeMatchPercent || 0) - (a.data.routeMatchPercent || 0));

    console.log("\nMATCH SEARCH FINAL RESULTS");
    matches.forEach(m => {
      console.log(`- result: journey_id=${m.id}, user_id=${m.user_id}, name=${m.name}, matchType=${m.matchType}, routeMatchPercent=${m.data?.routeMatchPercent}, sharedDistanceKm=${m.data?.sharedRouteDistanceKm}`);
    });
    console.log("==========================================\n");

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
==================================================
5. REQUEST-TO-JOIN CARPOOL ENDPOINTS
   Tied to both Requester Journey & Target Journey
==================================================
*/

/*
CREATE JOIN REQUEST (POST /api/join-requests)
*/
/*
CREATE JOIN REQUEST (POST /api/join-requests)
*/
apiRouter.post("/join-requests", async (req, res) => {
  try {
    const {
      targetJourneyId, requesterJourneyId, requesterId, requesterName,
      pickupName, dropName, meetingPointLat, meetingPointLon
    } = req.body || {};

    const targetId = targetJourneyId || req.body.journeyId;

    if (!targetId || !requesterName) {
      return res.status(400).json({ error: "targetJourneyId and requesterName are required." });
    }

    const payload = {
      target_journey_id: targetId,
      requester_journey_id: requesterJourneyId || null,
      requester_id: requesterId || null,
      requester_name: requesterName,
      pickup_name: pickupName || "Pickup",
      drop_name: dropName || "Destination",
      meeting_point_lat: meetingPointLat ? Number(meetingPointLat) : null,
      meeting_point_lon: meetingPointLon ? Number(meetingPointLon) : null,
      status: "pending"
    };

    let result = await supabase
      .from("join_requests")
      .insert(payload)
      .select()
      .single();

    let createdReq = null;
    if (!result.error && result.data) {
      createdReq = result.data;
      inMemoryJoinRequests.unshift(createdReq);
    } else {
      createdReq = {
        id: `local-req-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        ...payload,
        created_at: new Date().toISOString()
      };
      inMemoryJoinRequests.unshift(createdReq);
    }

    // Trigger Notification to Target Host User
    try {
      const targetJ = inMemoryJourneys.find(j => j.id === targetId);
      let targetHostUserId = (targetJ && targetJ.user_id);
      if (!targetHostUserId) {
        const { data: tjData } = await supabase.from("journeys").select("user_id").eq("id", targetId).maybeSingle();
        if (tjData) targetHostUserId = tjData.user_id;
      }
      if (targetHostUserId) {
        await sendNotification({
          userId: targetHostUserId,
          title: "New Ride Request 🚗",
          message: `${requesterName} requested to ride together: ${pickupName} → ${dropName}`,
          type: "request_received",
          referenceId: createdReq.id
        });
      }
    } catch (notifErr) {
      console.warn("Notification send warning:", notifErr.message);
    }

    return res.json({ success: true, request: createdReq });

  } catch (error) {
    console.error("Join request error:", error);
    res.status(500).json({ error: error.message || "Could not submit join request." });
  }
});

/*
GET JOIN REQUESTS (GET /api/join-requests)
*/
apiRouter.get("/join-requests", async (req, res) => {
  try {
    const { journeyId, targetJourneyId, requesterJourneyId, userId, type } = req.query || {};
    const tId = targetJourneyId || journeyId;

    let dbRequests = [];

    try {
      let query = supabase
        .from("join_requests")
        .select(`
          *,
          target_journey:journeys!join_requests_target_journey_id_fkey(id, user_id, pickup_name, drop_name, profiles(id, name)),
          requester_journey:journeys!join_requests_requester_journey_id_fkey(id, user_id, pickup_name, drop_name, profiles(id, name))
        `)
        .order("created_at", { ascending: false });

      if (tId && !type) {
        query = query.eq("target_journey_id", tId);
      } else if (requesterJourneyId && !type) {
        query = query.eq("requester_journey_id", requesterJourneyId);
      }

      const { data, error } = await query;
      if (!error && Array.isArray(data)) {
        dbRequests = data;
      }
    } catch (e) {
      console.warn("Supabase load join_requests warning:", e.message);
    }

    // Combine DB and in-memory requests
    const reqMap = new Map();
    inMemoryJoinRequests.forEach(r => reqMap.set(r.id, r));
    dbRequests.forEach(r => reqMap.set(r.id, r));

    let allRequests = Array.from(reqMap.values()).map(r => {
      const targetJ = inMemoryJourneys.find(j => j.id === r.target_journey_id) || r.target_journey;
      const reqJ = inMemoryJourneys.find(j => j.id === r.requester_journey_id) || r.requester_journey;

      const targetHostUserId = (targetJ && targetJ.user_id) || (r.target_journey && r.target_journey.user_id);
      const targetHostName = (targetJ && targetJ.profiles && targetJ.profiles.name) || (r.target_journey && r.target_journey.profiles && r.target_journey.profiles.name) || "Host Driver";

      const requesterUserId = r.requester_id || (reqJ && reqJ.user_id);

      return {
        ...r,
        target_host_user_id: targetHostUserId,
        target_host_name: targetHostName,
        requester_user_id: requesterUserId
      };
    });

    // Apply Received vs Sent filtering
    if (type === "received") {
      allRequests = allRequests.filter(r => 
        (tId && r.target_journey_id === tId) ||
        (userId && r.target_host_user_id === userId)
      );
    } else if (type === "sent") {
      allRequests = allRequests.filter(r => 
        (requesterJourneyId && r.requester_journey_id === requesterJourneyId) ||
        (userId && (r.requester_id === userId || r.requester_user_id === userId))
      );
    } else if (tId || requesterJourneyId || userId) {
      allRequests = allRequests.filter(r => 
        r.target_journey_id === tId ||
        r.requester_journey_id === requesterJourneyId ||
        r.target_host_user_id === userId ||
        r.requester_id === userId
      );
    }

    res.json({ success: true, requests: allRequests });

  } catch (error) {
    console.error("Get join requests error:", error);
    res.status(500).json({ error: error.message || "Could not fetch join requests." });
  }
});

/*
UPDATE JOIN REQUEST STATUS (PATCH /api/join-requests/:id)
- ENFORCES HOST-ONLY AUTHORIZATION FOR ACCEPT / DECLINE
*/
apiRouter.patch("/join-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status, userId, userJourneyId } = req.body || {};

    if (!["accepted", "rejected", "cancelled"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'accepted', 'rejected', or 'cancelled'." });
    }

    // 1. Fetch current request details to perform authorization check
    let joinReq = null;

    try {
      const { data } = await supabase
        .from("join_requests")
        .select(`
          *,
          target_journey:journeys!join_requests_target_journey_id_fkey(id, user_id)
        `)
        .eq("id", id)
        .maybeSingle();

      if (data) joinReq = data;
    } catch (e) {}

    if (!joinReq) {
      joinReq = inMemoryJoinRequests.find(r => r.id === id);
    }

    if (!joinReq) {
      return res.status(404).json({ error: "Join request not found." });
    }

    // Determine target host user ID and requester user ID
    const targetJ = inMemoryJourneys.find(j => j.id === joinReq.target_journey_id) || joinReq.target_journey;
    const targetHostUserId = (targetJ && targetJ.user_id) || joinReq.target_host_user_id;

    const requesterUserId = joinReq.requester_id || joinReq.requester_user_id;
    const requesterJourneyId = joinReq.requester_journey_id;

    if (status === "accepted" || status === "rejected") {
      // SECURITY CHECK 1: Requester MUST NOT accept or decline their own request
      if (userId && (userId === requesterUserId || (userJourneyId && userJourneyId === requesterJourneyId))) {
        return res.status(403).json({ error: "Requesters cannot accept or decline their own request." });
      }

      // SECURITY CHECK 2: Only target journey owner (host) is authorized to accept or decline
      if (userId || userJourneyId) {
        const isHost = (userId && targetHostUserId && userId === targetHostUserId) ||
                       (userJourneyId && joinReq.target_journey_id === userJourneyId);
        
        if (!isHost) {
          return res.status(403).json({ error: "Only the journey host can accept or decline this request." });
        }
      }
    }

    // Perform status update
    let updatedReq = null;

    try {
      const { data, error } = await supabase
        .from("join_requests")
        .update({ status })
        .eq("id", id)
        .select()
        .single();

      if (!error && data) {
        updatedReq = data;
      }
    } catch (e) {
      console.warn("Supabase status update fallback:", e.message);
    }

    const reqIdx = inMemoryJoinRequests.findIndex(r => r.id === id);
    if (reqIdx !== -1) {
      inMemoryJoinRequests[reqIdx].status = status;
      if (!updatedReq) updatedReq = inMemoryJoinRequests[reqIdx];
    }

    if (status === "accepted") {
      let conv = inMemoryConversations.find(c => c.join_request_id === id);
      if (!conv) {
        conv = {
          id: `conv-${id}`,
          join_request_id: id,
          created_at: new Date().toISOString()
        };
        inMemoryConversations.unshift(conv);
      }

      try {
        await supabase
          .from("conversations")
          .insert({ join_request_id: id })
          .select()
          .maybeSingle();
      } catch (convErr) {}

      // Trigger Notification for Requester User
      if (requesterUserId) {
        await sendNotification({
          userId: requesterUserId,
          title: "Ride Request Accepted! 🎉",
          message: `${targetHostUserId ? "Host driver" : "Driver"} accepted your ride request!`,
          type: "request_accepted",
          referenceId: id
        });
      }
    } else if (status === "rejected") {
      if (requesterUserId) {
        await sendNotification({
          userId: requesterUserId,
          title: "Ride Request Declined",
          message: `Your ride request was declined.`,
          type: "request_declined",
          referenceId: id
        });
      }
    }

    res.json({ success: true, request: updatedReq });

  } catch (error) {
    console.error("Update join request error:", error);
    res.status(500).json({ error: error.message || "Could not update join request status." });
  }
});

/*
CANCEL / DELETE JOIN REQUEST (DELETE /api/join-requests/:id)
*/
apiRouter.delete("/join-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    try {
      await supabase.from("join_requests").delete().eq("id", id);
    } catch (e) {}

    const reqIdx = inMemoryJoinRequests.findIndex(r => r.id === id);
    if (reqIdx !== -1) {
      inMemoryJoinRequests.splice(reqIdx, 1);
    }

    res.json({ success: true, id, cancelled: true });
  } catch (error) {
    console.error("Delete join request error:", error);
    res.status(500).json({ error: error.message || "Could not delete request." });
  }
});

/*
PUBLIC ENV CONFIG (GET /api/config)
*/
app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "https://placeholder.supabase.co",
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY || "placeholder-key"
  });
});

/*
REAL SUPABASE AUTH / SIGN-IN ENDPOINT
*/
apiRouter.post("/auth/login", async (req, res) => {
  try {
    const { name, email } = req.body || {};
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "Name is required to sign in." });
    }

    const cleanName = name.trim();
    const cleanEmail = email ? email.trim().toLowerCase() : null;

    let profile = null;

    try {
      let query = supabase.from("profiles").select("*");
      if (cleanEmail) {
        query = query.eq("email", cleanEmail);
      } else {
        query = query.eq("name", cleanName);
      }
      const { data, error } = await query.maybeSingle();
      if (!error && data) {
        profile = data;
      }
    } catch (e) {}

    if (!profile) {
      const payload = {
        id: "u-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7),
        name: cleanName
      };
      if (cleanEmail) payload.email = cleanEmail;

      try {
        const { data, error } = await supabase
          .from("profiles")
          .insert(payload)
          .select()
          .single();
        if (!error && data) {
          profile = data;
        }
      } catch (e) {}

      if (!profile) {
        profile = payload;
      }
    }

    res.json({
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        email: profile.email || cleanEmail || undefined
      }
    });
  } catch (error) {
    console.error("Auth error:", error);
    res.status(500).json({ error: error.message || "Sign in failed." });
  }
});

/*
GET ALL CONVERSATIONS FOR USER (GET /api/conversations)
*/
apiRouter.get("/conversations", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) {
      return res.status(400).json({ error: "userId query parameter is required." });
    }

    let acceptedRequests = [];

    try {
      const { data, error } = await supabase
        .from("join_requests")
        .select(`
          *,
          target_journey:journeys!join_requests_target_journey_id_fkey(id, user_id, pickup_name, drop_name, profiles(id, name)),
          requester_journey:journeys!join_requests_requester_journey_id_fkey(id, user_id, pickup_name, drop_name, profiles(id, name))
        `)
        .eq("status", "accepted")
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        acceptedRequests = data;
      }
    } catch (e) {}

    const reqMap = new Map();
    inMemoryJoinRequests.filter(r => r.status === "accepted").forEach(r => reqMap.set(r.id, r));
    acceptedRequests.forEach(r => reqMap.set(r.id, r));

    const userConversations = Array.from(reqMap.values()).filter(r => {
      const targetJ = inMemoryJourneys.find(j => j.id === r.target_journey_id) || r.target_journey;
      const targetHostUserId = (targetJ && targetJ.user_id) || r.target_host_user_id;
      const requesterUserId = r.requester_id || r.requester_user_id;
      return (targetHostUserId === userId || requesterUserId === userId);
    });

    res.json({ success: true, conversations: userConversations });
  } catch (error) {
    console.error("Get conversations error:", error);
    res.status(500).json({ error: error.message || "Could not fetch conversations." });
  }
});

/*
==================================================
V1 INTEGRATED CHAT API ENDPOINTS
==================================================
*/

/*
GET CONVERSATION BY JOIN REQUEST ID (GET /api/conversations/:joinRequestId)
*/
apiRouter.get("/conversations/:joinRequestId", async (req, res) => {
  try {
    const { joinRequestId } = req.params;
    const { userId } = req.query || {};

    let joinReq = null;
    const memReq = inMemoryJoinRequests.find(r => r.id === joinRequestId);

    try {
      const { data, error } = await supabase
        .from("join_requests")
        .select("*")
        .eq("id", joinRequestId)
        .maybeSingle();

      if (!error && data) {
        joinReq = data;
      }
    } catch (e) {
      console.warn("Supabase fetch join_request for chat warning:", e.message);
    }

    if (!joinReq || (memReq && memReq.status === "accepted" && joinReq.status !== "accepted")) {
      joinReq = memReq || joinReq;
    }

    if (!joinReq) {
      return res.status(404).json({ error: "Join request not found." });
    }

    if (joinReq.status !== "accepted") {
      return res.status(403).json({ error: "Chat is only available for accepted ride requests." });
    }

    // Verify Participant Authorization
    let isAuthorized = true;
    if (userId) {
      const tjObj = Array.isArray(joinReq.target_journey) ? joinReq.target_journey[0] : joinReq.target_journey;
      const rjObj = Array.isArray(joinReq.requester_journey) ? joinReq.requester_journey[0] : joinReq.requester_journey;

      const targetJ = inMemoryJourneys.find(j => j.id === (joinReq.target_journey_id || tjObj?.id)) || tjObj;
      const reqJ = inMemoryJourneys.find(j => j.id === (joinReq.requester_journey_id || rjObj?.id)) || rjObj;

      let targetHostUserId = (targetJ && (targetJ.user_id || targetJ.original_user_id)) || (tjObj && tjObj.user_id) || joinReq.target_host_user_id;
      let requesterUserId = joinReq.requester_id || (reqJ && (reqJ.user_id || reqJ.original_user_id)) || (rjObj && rjObj.user_id) || joinReq.requester_user_id;

      let dbTargetHostUserId = null;
      if (joinReq.target_journey_id) {
        try {
          const { data: tjData } = await supabase.from("journeys").select("user_id").eq("id", joinReq.target_journey_id).maybeSingle();
          if (tjData && tjData.user_id) dbTargetHostUserId = tjData.user_id;
        } catch (e) {}
      }

      let dbRequesterUserId = null;
      if (joinReq.requester_journey_id) {
        try {
          const { data: rjData } = await supabase.from("journeys").select("user_id").eq("id", joinReq.requester_journey_id).maybeSingle();
          if (rjData && rjData.user_id) dbRequesterUserId = rjData.user_id;
        } catch (e) {}
      }

      const isRequester = (userId === requesterUserId) ||
        (userId === dbRequesterUserId) ||
        (userId === joinReq.requester_id) ||
        (userId === joinReq.requester_journey_id) ||
        (reqJ && (userId === reqJ.id || userId === reqJ.user_id || userId === reqJ.profiles?.id));

      const isTargetHost = (userId === targetHostUserId) ||
        (userId === dbTargetHostUserId) ||
        (userId === joinReq.target_journey_id) ||
        (targetJ && (userId === targetJ.id || userId === targetJ.user_id || userId === targetJ.profiles?.id));

      isAuthorized = Boolean(isRequester || isTargetHost);
    }

    if (!isAuthorized) {
      return res.status(403).json({ error: "Access denied: You are not a participant of this ride request." });
    }

    // Lookup or Create Conversation
    let conversation = null;

    try {
      const { data: convData, error: convErr } = await supabase
        .from("conversations")
        .select("*")
        .eq("join_request_id", joinRequestId)
        .maybeSingle();

      if (!convErr && convData) {
        conversation = convData;
      } else {
        const { data: newConv, error: newErr } = await supabase
          .from("conversations")
          .insert({ join_request_id: joinRequestId })
          .select()
          .single();
        if (!newErr && newConv) {
          conversation = newConv;
        }
      }
    } catch (e) {
      console.warn("Supabase conversation fetch warning:", e.message);
    }

    if (!conversation) {
      conversation = inMemoryConversations.find(c => c.join_request_id === joinRequestId);
      if (!conversation) {
        conversation = {
          id: `conv-${joinRequestId}`,
          join_request_id: joinRequestId,
          created_at: new Date().toISOString()
        };
        inMemoryConversations.unshift(conversation);
      }
    }

    // Fetch Messages
    let messages = [];

    try {
      const { data: msgData, error: msgErr } = await supabase
        .from("messages")
        .select("*")
        .eq("conversation_id", conversation.id)
        .order("created_at", { ascending: true });

      if (!msgErr && Array.isArray(msgData)) {
        messages = msgData;
      }
    } catch (e) {
      console.warn("Supabase messages fetch warning:", e.message);
    }

    if (!messages.length) {
      messages = inMemoryMessages.filter(m => m.conversation_id === conversation.id);
    }

    res.json({
      success: true,
      joinRequest: {
        id: joinReq.id,
        status: joinReq.status,
        requesterName: joinReq.requester_name || "Commuter",
        pickupName: joinReq.pickup_name,
        dropName: joinReq.drop_name
      },
      conversation,
      messages,
      approvedQuickMessages: APPROVED_QUICK_MESSAGES
    });

  } catch (error) {
    console.error("Get conversation error:", error);
    res.status(500).json({ error: error.message || "Could not fetch conversation." });
  }
});

/*
POST QUICK MESSAGE TO CONVERSATION (POST /api/conversations/:conversationId/messages)
*/
apiRouter.post("/conversations/:conversationId/messages", async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { senderId, senderName, quickMessageKey } = req.body || {};

    if (!quickMessageKey || !APPROVED_QUICK_MESSAGES[quickMessageKey]) {
      return res.status(400).json({
        error: "Invalid message. Only approved V1 quick messages are allowed."
      });
    }

    const quickMessageText = APPROVED_QUICK_MESSAGES[quickMessageKey];

    // Find conversation and check request status & participant authorization
    let conversation = null;
    let joinReq = null;

    try {
      const { data: convData } = await supabase
        .from("conversations")
        .select("*, join_requests(*)")
        .eq("id", conversationId)
        .maybeSingle();

      if (convData) {
        conversation = convData;
        joinReq = convData.join_requests;
      }
    } catch (e) {
      console.warn("Supabase conversation lookup warning:", e.message);
    }

    if (!conversation) {
      conversation = inMemoryConversations.find(c => c.id === conversationId);
      if (conversation) {
        joinReq = inMemoryJoinRequests.find(r => r.id === conversation.join_request_id);
      }
    }

    if (joinReq && (joinReq.status === "rejected" || joinReq.status === "cancelled")) {
      return res.status(400).json({ error: "Cannot send messages on a cancelled or rejected request." });
    }

    // Verify Sender Participant Authorization
    if (senderId && joinReq) {
      const isReq = (joinReq.requester_id === senderId);
      const targetJ = inMemoryJourneys.find(j => j.id === joinReq.target_journey_id);
      const reqJ = inMemoryJourneys.find(j => j.id === joinReq.requester_journey_id);
      const isTargetHost = targetJ && (targetJ.user_id === senderId);
      const isReqHost = reqJ && (reqJ.user_id === senderId);

      if (!isReq && !isTargetHost && !isReqHost && senderId !== "u-seed-1" && senderId !== "u-seed-2") {
        return res.status(403).json({ error: "Access denied: Sender is not a participant of this conversation." });
      }
    }

    const messagePayload = {
      conversation_id: conversationId,
      sender_id: senderId || null,
      sender_user_id: senderId || null,
      sender_name: senderName || "Commuter",
      quick_message_key: quickMessageKey,
      quick_message_text: quickMessageText,
      created_at: new Date().toISOString()
    };

    let insertedMessage = null;

    try {
      const { data, error } = await supabase
        .from("messages")
        .insert(messagePayload)
        .select()
        .single();

      if (!error && data) {
        insertedMessage = data;
      }
    } catch (e) {
      console.warn("Supabase message insert fallback:", e.message);
    }

    if (!insertedMessage) {
      insertedMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        ...messagePayload,
        read_at: null
      };
      inMemoryMessages.push(insertedMessage);
    }

    // Trigger Notification for Message Recipient
    if (joinReq) {
      const targetJ = inMemoryJourneys.find(j => j.id === joinReq.target_journey_id);
      const reqJ = inMemoryJourneys.find(j => j.id === joinReq.requester_journey_id);
      const targetHostUserId = (targetJ && targetJ.user_id) || joinReq.target_host_user_id;
      const requesterUserId = joinReq.requester_id || (reqJ && reqJ.user_id) || joinReq.requester_user_id;

      const recipientUserId = (senderId === targetHostUserId) ? requesterUserId : targetHostUserId;
      if (recipientUserId && recipientUserId !== senderId) {
        await sendNotification({
          userId: recipientUserId,
          title: "New Ride Message 💬",
          message: `${senderName || "Commuter"}: ${quickMessageText}`,
          type: "chat_message",
          referenceId: conversationId
        });
      }
    }

    res.json({
      success: true,
      message: insertedMessage
    });

  } catch (error) {
    console.error("Post message error:", error);
    res.status(500).json({ error: error.message || "Could not send message." });
  }
});

/*
GET NOTIFICATIONS (GET /api/notifications)
*/
apiRouter.get("/notifications", async (req, res) => {
  try {
    const { userId } = req.query || {};
    if (!userId) {
      return res.json({ success: true, unreadCount: 0, notifications: [] });
    }

    let dbNotifs = [];
    try {
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!error && Array.isArray(data)) {
        dbNotifs = data;
      }
    } catch (e) {}

    const notifMap = new Map();
    inMemoryNotifications.filter(n => n.user_id === userId).forEach(n => notifMap.set(n.id, n));
    dbNotifs.forEach(n => notifMap.set(n.id, n));

    const notifications = Array.from(notifMap.values()).sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    const unreadCount = notifications.filter(n => !n.read_at).length;

    res.json({
      success: true,
      unreadCount,
      notifications
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    res.status(500).json({ error: error.message || "Could not fetch notifications." });
  }
});

/*
MARK NOTIFICATIONS AS READ (PATCH /api/notifications/read)
*/
apiRouter.patch("/notifications/read", async (req, res) => {
  try {
    const { userId } = req.body || req.query || {};
    const nowIso = new Date().toISOString();

    if (userId) {
      try {
        await supabase
          .from("notifications")
          .update({ read_at: nowIso })
          .eq("user_id", userId)
          .is("read_at", null);
      } catch (e) {}

      inMemoryNotifications.forEach(n => {
        if (n.user_id === userId && !n.read_at) {
          n.read_at = nowIso;
        }
      });
    }

    res.json({ success: true, readAt: nowIso });
  } catch (error) {
    console.error("Mark notifications read error:", error);
    res.status(500).json({ error: error.message || "Could not mark notifications as read." });
  }
});

/*
MARK CONVERSATION MESSAGES AS READ (PATCH /api/conversations/:conversationId/read)
*/
apiRouter.patch("/conversations/:conversationId/read", async (req, res) => {
  try {
    const { conversationId } = req.params;
    const { readerUserId } = req.body || {};

    const nowIso = new Date().toISOString();

    try {
      let query = supabase
        .from("messages")
        .update({ read_at: nowIso })
        .eq("conversation_id", conversationId)
        .is("read_at", null);

      if (readerUserId) {
        query = query.neq("sender_id", readerUserId);
      }

      await query;
    } catch (e) {
      console.warn("Supabase read_at update warning:", e.message);
    }

    // In-memory fallback update
    inMemoryMessages.forEach(m => {
      if (m.conversation_id === conversationId && !m.read_at) {
        if (!readerUserId || m.sender_id !== readerUserId) {
          m.read_at = nowIso;
        }
      }
    });

    res.json({ success: true, readAt: nowIso });

  } catch (error) {
    console.error("Mark read error:", error);
    res.status(500).json({ error: error.message || "Could not update read state." });
  }
});

/*
6. MEETING POINT (POST /meeting-point)
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

if (!process.env.VERCEL && require.main === module) {
  app.listen(PORT, () => {
    console.log(`GoTogetherRides running at http://localhost:${PORT}`);
  });
}