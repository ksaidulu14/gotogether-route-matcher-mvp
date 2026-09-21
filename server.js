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
const inMemoryJourneys = [
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

    // IDEMPOTENCE CHECK: Reuse existing active journey if details match
    const existingInMemory = inMemoryJourneys.find(j => 
      j.status === "active" &&
      (j.id === req.body.requesterJourneyId || 
       j.user_id === req.body.userId ||
       ((j.profiles?.name?.toLowerCase() === name.toLowerCase() || j.pickup_name?.toLowerCase() === pickup.toLowerCase()) &&
        j.drop_name?.toLowerCase() === drop.toLowerCase() &&
        (j.departure_date === targetDate || !j.departure_date) &&
        (j.departure_time?.substring(0, 5) === targetTime.substring(0, 5) || !j.departure_time)
       )
      )
    );

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
      let queryRes = await supabase
        .from("journeys")
        .select(`
          id, user_id, pickup_name, pickup_lat, pickup_lon, drop_name, drop_lat, drop_lon,
          departure_date, departure_time, status, bearing_degrees, route_distance_meters,
          profiles ( id, name )
        `)
        .eq("status", "active")
        .order("created_at", { ascending: false });

      if (queryRes.error && queryRes.error.message.includes("column")) {
        queryRes = await supabase
          .from("journeys")
          .select(`
            id, user_id, pickup_name, pickup_lat, pickup_lon, drop_name, drop_lat, drop_lon,
            status, profiles ( id, name )
          `)
          .eq("status", "active")
          .order("created_at", { ascending: false });
      }

      if (!queryRes.error && Array.isArray(queryRes.data)) {
        const match = queryRes.data.find(j => {
          if (j.id === req.body.requesterJourneyId || j.user_id === req.body.userId) return true;
          const pName = Array.isArray(j.profiles) ? j.profiles[0]?.name : j.profiles?.name;
          const nameMatch = pName ? pName.toLowerCase() === name.toLowerCase() : true;
          const pickupMatch = j.pickup_name?.toLowerCase() === pickup.toLowerCase() ||
            haversineKm(j.pickup_lat, j.pickup_lon, pickupGeo.lat, pickupGeo.lon) <= 0.5;
          const dropMatch = j.drop_name?.toLowerCase() === drop.toLowerCase() ||
            haversineKm(j.drop_lat, j.drop_lon, dropGeo.lat, dropGeo.lon) <= 0.5;
          const dateMatch = !j.departure_date || j.departure_date === targetDate;
          return nameMatch && pickupMatch && dropMatch && dateMatch;
        });

        if (match) {
          return res.json({
            success: true,
            reused: true,
            profile: (Array.isArray(match.profiles) ? match.profiles[0] : match.profiles) || { id: match.user_id, name },
            journey: {
              id: match.id,
              user_id: match.user_id,
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
      const { data: dbProfile, error: profileError } = await supabase
        .from("profiles")
        .insert({ name })
        .select()
        .single();
      if (!profileError && dbProfile) {
        profile = dbProfile;
        profileId = dbProfile.id;
      }
    } catch (e) {
      console.warn("Supabase profile insert fallback:", e.message);
    }

    if (!profile) {
      profileId = "u-" + Date.now() + "-" + Math.random().toString(36).substring(2, 7);
      profile = { id: profileId, name };
    }

    let journeyPayload = {
      user_id: profileId,
      pickup_name: pickup,
      pickup_lat: pickupGeo.lat,
      pickup_lon: pickupGeo.lon,
      drop_name: drop,
      drop_lat: dropGeo.lat,
      drop_lon: dropGeo.lon,
      departure_date: departureDate || todayStr,
      departure_time: departureTime ? (departureTime.length === 5 ? `${departureTime}:00` : departureTime) : defaultTimeStr,
      status: "active"
    };

    if (routeGeojson && bearingDegrees !== null) {
      journeyPayload.route_geojson = routeGeojson;
      journeyPayload.route_distance_meters = routeDistanceMeters;
      journeyPayload.bearing_degrees = bearingDegrees;
    }

    let journey = null;

    try {
      let journeyResult = await supabase
        .from("journeys")
        .insert(journeyPayload)
        .select()
        .single();

      if (journeyResult && journeyResult.error && journeyResult.error.message.includes("column")) {
        delete journeyPayload.route_geojson;
        delete journeyPayload.route_distance_meters;
        delete journeyPayload.bearing_degrees;
        delete journeyPayload.departure_date;
        delete journeyPayload.departure_time;

        journeyResult = await supabase
          .from("journeys")
          .insert(journeyPayload)
          .select()
          .single();
      }

      if (journeyResult && !journeyResult.error && journeyResult.data) {
        journey = journeyResult.data;
      }
    } catch (e) {
      console.warn("Supabase journey insert fallback:", e.message);
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

    res.json({
      success: true,
      searchRadiusKm: Number(searchRadiusKm) || 10,
      journeys: Array.from(combinedMap.values())
    });
  } catch (error) {
    console.error("Load journeys error:", error);
    res.json({
      success: true,
      searchRadiusKm: 10,
      journeys: inMemoryJourneys
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
        target_date: departureDate || null
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
        const latDelta = radiusLimitKm / 111;
        const lonDelta = radiusLimitKm / (111 * Math.cos(rad(aPickupGeo.lat)));

        const { data, error } = await supabase
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

        if (!error && Array.isArray(data)) {
          dbJourneys = data;
        }
      } catch (dbErr) {
        console.warn("DB candidate query warning:", dbErr.message);
      }

      // Merge Supabase DB journeys with inMemoryJourneys
      const candidateMap = new Map();
      inMemoryJourneys.forEach(j => candidateMap.set(j.id, j));
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

    // EXCLUDE CURRENT USER'S OWN JOURNEY OR IDENTICAL PROFILE SEARCH
    candidates = candidates.filter(candidate => {
      if (requesterJourneyId && candidate.id === requesterJourneyId) return false;
      if (requesterUserId && candidate.user_id === requesterUserId) return false;
      if (requesterName && candidate.profile_name?.toLowerCase() === requesterName.toLowerCase() &&
          candidate.pickup_name?.toLowerCase() === aPickup.toLowerCase() &&
          candidate.drop_name?.toLowerCase() === aDrop.toLowerCase()) {
        return false;
      }
      return true;
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

        const dirB = candidate.bearing_degrees !== null && candidate.bearing_degrees !== undefined
          ? candidate.bearing_degrees
          : bearing(lineB[0], lineB[lineB.length - 1]);

        const directionDifference = angleDiff(userBearing, dirB);

        const directionOK = directionDifference <= 55;
        const corridorOK = shareAB >= 0.25 || shareBA >= 0.25 || (shareAB >= 0.20 && shareBA >= 0.20);
        const matched = directionOK && corridorOK;

        const DESTINATION_THRESHOLD_METERS = 1000;
        const PICKUP_THRESHOLD_METERS = 1000;

        const dropDistMeters = Math.round(minRouteDistance([aDropGeo.lon, aDropGeo.lat], lineB));
        const pickupDistMeters = Math.round(minRouteDistance([aPickupGeo.lon, aPickupGeo.lat], lineB));

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

          const isSeed = candidate.id && candidate.id.startsWith("j-seed-");
          const isTest = candidate.profile_name?.toLowerCase().includes("test") || (candidate.id && candidate.id.startsWith("j-178"));

          matches.push({
            id: candidate.id,
            journey_id: candidate.id,
            user_id: candidate.user_id,
            name: candidate.profile_name || "Traveler",
            pickup: cleanLocationDisplay(candidate.pickup_name) || candidate.pickup_name,
            drop: cleanLocationDisplay(candidate.drop_name) || candidate.drop_name,
            departure_date: candidate.departure_date || departureDate || null,
            departure_time: candidate.departure_time || departureTime || null,
            matchType,
            servesDestination,
            connectsPickup,
            partialDetails,
            isSeed,
            isTest,
            meetingData,
            data: {
              matched: true,
              matchType,
              servesDestination,
              connectsPickup,
              partialDetails,
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

    if (result.error) {
      // Fallback in-memory store if table is not yet created in Supabase
      const newRequest = {
        id: `local-req-${Date.now()}-${Math.floor(Math.random()*1000)}`,
        ...payload,
        created_at: new Date().toISOString()
      };
      inMemoryJoinRequests.unshift(newRequest);
      return res.json({ success: true, request: newRequest, storage: "in_memory" });
    }

    res.json({ success: true, request: result.data, storage: "supabase" });

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
    const { journeyId, targetJourneyId, requesterJourneyId } = req.query || {};
    const tId = targetJourneyId || journeyId;

    let query = supabase.from("join_requests").select("*").order("created_at", { ascending: false });
    if (tId) {
      query = query.eq("target_journey_id", tId);
    } else if (requesterJourneyId) {
      query = query.eq("requester_journey_id", requesterJourneyId);
    }

    const { data, error } = await query;

    if (error) {
      // Fallback to in-memory store
      let filtered = inMemoryJoinRequests;
      if (tId) {
        filtered = filtered.filter(r => r.target_journey_id === tId || r.journey_id === tId);
      } else if (requesterJourneyId) {
        filtered = filtered.filter(r => r.requester_journey_id === requesterJourneyId);
      }
      return res.json({ success: true, requests: filtered });
    }

    res.json({ success: true, requests: data || [] });

  } catch (error) {
    console.error("Get join requests error:", error);
    res.status(500).json({ error: error.message || "Could not fetch join requests." });
  }
});

/*
UPDATE JOIN REQUEST STATUS (PATCH /api/join-requests/:id)
*/
apiRouter.patch("/join-requests/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body || {};

    if (!["accepted", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Status must be 'accepted' or 'rejected'." });
    }

    const { data, error } = await supabase
      .from("join_requests")
      .update({ status })
      .eq("id", id)
      .select()
      .single();

    if (error) {
      // Fallback to in-memory array update
      const reqIdx = inMemoryJoinRequests.findIndex(r => r.id === id);
      if (reqIdx !== -1) {
        inMemoryJoinRequests[reqIdx].status = status;
        return res.json({ success: true, request: inMemoryJoinRequests[reqIdx] });
      }
      return res.status(404).json({ error: "Join request not found." });
    }

    res.json({ success: true, request: data });

  } catch (error) {
    console.error("Update join request error:", error);
    res.status(500).json({ error: error.message || "Could not update join request status." });
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

if (!process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`GoTogetherRides running at http://localhost:${PORT}`);
  });
}