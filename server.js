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

  const response =
    await fetch(
      url,
      {
        headers: {
          "User-Agent":
            "GoTogetherRouteMatcherMVP/0.1 (prototype)"
        }
      }
    );

  if (!response.ok) {
    throw new Error(
      "Geocoding failed: " +
      response.status
    );
  }

  const data =
    await response.json();

  if (!data.length) {
    throw new Error(
      "Location not found: " +
      query
    );
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    display: data[0].display_name
  };
}


/*
==================================================
OSRM ROUTING
==================================================
*/

async function osrmRoute(a, b) {

  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lon},${a.lat};${b.lon},${b.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const response =
    await fetch(url);

  if (!response.ok) {
    throw new Error(
      "Routing failed: " +
      response.status
    );
  }

  const data =
    await response.json();

  if (
    data.code !== "Ok" ||
    !data.routes ||
    !data.routes.length
  ) {
    throw new Error(
      "No driving route found."
    );
  }

  return data.routes[0];
}


/*
==================================================
GEOMETRY HELPERS
==================================================
*/

function rad(x) {
  return x * Math.PI / 180;
}


function bearing(a, b) {

  const p1 = rad(a[1]);
  const p2 = rad(b[1]);

  const dl =
    rad(
      b[0] - a[0]
    );

  const y =
    Math.sin(dl) *
    Math.cos(p2);

  const x =
    Math.cos(p1) *
    Math.sin(p2) -
    Math.sin(p1) *
    Math.cos(p2) *
    Math.cos(dl);

  return (
    Math.atan2(y, x) *
    180 /
    Math.PI +
    360
  ) % 360;
}


function angleDiff(a, b) {

  const d =
    Math.abs(a - b) % 360;

  return d > 180
    ? 360 - d
    : d;
}


function pointSegDist(p, a, b) {

  const lat0 =
    rad(p[1]);

  const kx =
    111320 *
    Math.cos(lat0);

  const ky =
    110540;

  const px =
    p[0] * kx;

  const py =
    p[1] * ky;

  const ax =
    a[0] * kx;

  const ay =
    a[1] * ky;

  const bx =
    b[0] * kx;

  const by =
    b[1] * ky;

  const dx =
    bx - ax;

  const dy =
    by - ay;

  const len2 =
    dx * dx +
    dy * dy;

  let t =
    len2
      ? (
          (px - ax) * dx +
          (py - ay) * dy
        ) / len2
      : 0;

  t =
    Math.max(
      0,
      Math.min(1, t)
    );

  return Math.hypot(
    px -
      (ax + t * dx),

    py -
      (ay + t * dy)
  );
}


function minRouteDistance(
  p,
  line
) {

  let best =
    Infinity;

  for (
    let i = 1;
    i < line.length;
    i++
  ) {

    best =
      Math.min(
        best,

        pointSegDist(
          p,
          line[i - 1],
          line[i]
        )
      );

  }

  return best;
}


function sample(
  line,
  n = 100
) {

  if (
    line.length <= n
  ) {
    return line;
  }

  const out = [];

  for (
    let i = 0;
    i < n;
    i++
  ) {

    out.push(
      line[
        Math.round(
          i *
          (line.length - 1) /
          (n - 1)
        )
      ]
    );

  }

  return out;
}


function corridorShare(
  lineA,
  lineB,
  threshold = 1000
) {

  const samples =
    sample(
      lineA,
      100
    );

  let near = 0;

  for (
    const point of samples
  ) {

    if (
      minRouteDistance(
        point,
        lineB
      ) <= threshold
    ) {

      near++;

    }

  }

  return (
    near /
    samples.length
  );
}


/*
==================================================
MEETING POINT HELPER
==================================================
*/

function findMeetingPoint(
  lineA,
  lineB,
  threshold = 1000
) {

  const samplesA =
    sample(
      lineA,
      200
    );

  const samplesB =
    sample(
      lineB,
      200
    );

  const candidates = [];


  for (
    const pointA of samplesA
  ) {

    const distanceToB =
      minRouteDistance(
        pointA,
        lineB
      );

    if (
      distanceToB <= threshold
    ) {

      candidates.push({
        point: pointA,
        distance:
          distanceToB
      });

    }

  }


  for (
    const pointB of samplesB
  ) {

    const distanceToA =
      minRouteDistance(
        pointB,
        lineA
      );

    if (
      distanceToA <= threshold
    ) {

      candidates.push({
        point: pointB,
        distance:
          distanceToA
      });

    }

  }


  if (
    !candidates.length
  ) {

    return null;

  }


  candidates.sort(
    (a, b) =>
      a.distance -
      b.distance
  );


  const best =
    candidates[0];


  return {

    lon:
      best.point[0],

    lat:
      best.point[1],

    distanceToOtherRouteMeters:
      Math.round(
        best.distance
      )

  };

}


/*
==================================================
EXPRESS ROUTER (MOUNTED DUAL FOR VERCEL & LOCAL)
==================================================
*/

const apiRouter = express.Router();

/*
1. CREATE JOURNEY (POST /journeys)
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

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .insert({ name })
      .select()
      .single();

    if (profileError) throw profileError;

    const { data: journey, error: journeyError } = await supabase
      .from("journeys")
      .insert({
        user_id: profile.id,
        pickup_name: pickup,
        pickup_lat: pickupGeo.lat,
        pickup_lon: pickupGeo.lon,
        drop_name: drop,
        drop_lat: dropGeo.lat,
        drop_lon: dropGeo.lon,
        status: "active"
      })
      .select()
      .single();

    if (journeyError) throw journeyError;

    res.json({
      success: true,
      profile,
      journey: {
        id: journey.id,
        user_id: journey.user_id,
        pickup: { name: journey.pickup_name, lat: journey.pickup_lat, lon: journey.pickup_lon },
        drop: { name: journey.drop_name, lat: journey.drop_lat, lon: journey.drop_lon },
        status: journey.status
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
3. MATCH JOURNEYS (POST /match)
*/
apiRouter.post("/match", async (req, res) => {
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

    const meetingPoint = findMeetingPoint(lineA, lineB, 1000);
    const meetingData = meetingPoint
      ? { found: true, meetingPoint }
      : { found: false, meetingPoint: null };

    res.json({
      matched,
      thresholdMeters: 1000,
      directionDifference,
      shareAB,
      shareBA,
      routeOverlapPercent,
      directionAlignmentPercent,
      routeMatchPercent,
      meetingData,
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
4. MEETING POINT (POST /meeting-point)
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