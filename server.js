const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function geocode(query) {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=in&q=" +
    encodeURIComponent(query);

  const r = await fetch(url, {
    headers: {
      "User-Agent": "GoTogetherRouteMatcherMVP/0.1 (prototype)"
    }
  });

  if (!r.ok) {
    throw new Error("Geocoding failed: " + r.status);
  }

  const data = await r.json();

  if (!data.length) {
    throw new Error("Location not found: " + query);
  }

  return {
    lat: Number(data[0].lat),
    lon: Number(data[0].lon),
    display: data[0].display_name
  };
}

async function osrmRoute(a, b) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lon},${a.lat};${b.lon},${b.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const r = await fetch(url);

  if (!r.ok) {
    throw new Error("Routing failed: " + r.status);
  }

  const data = await r.json();

  if (
    data.code !== "Ok" ||
    !data.routes ||
    !data.routes.length
  ) {
    throw new Error("No driving route found.");
  }

  return data.routes[0];
}

function rad(x) {
  return x * Math.PI / 180;
}

function bearing(a, b) {
  const p1 = rad(a[1]);
  const p2 = rad(b[1]);
  const dl = rad(b[0] - a[0]);

  const y =
    Math.sin(dl) * Math.cos(p2);

  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) *
    Math.cos(p2) *
    Math.cos(dl);

  return (
    Math.atan2(y, x) * 180 / Math.PI + 360
  ) % 360;
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

  let t = len2
    ? ((px - ax) * dx + (py - ay) * dy) / len2
    : 0;

  t = Math.max(0, Math.min(1, t));

  return Math.hypot(
    px - (ax + t * dx),
    py - (ay + t * dy)
  );
}

function minRouteDistance(p, line) {
  let best = Infinity;

  for (let i = 1; i < line.length; i++) {
    best = Math.min(
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

function sample(line, n = 100) {
  if (line.length <= n) {
    return line;
  }

  const out = [];

  for (let i = 0; i < n; i++) {
    out.push(
      line[
        Math.round(
          i * (line.length - 1) / (n - 1)
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
  const s = sample(lineA, 100);

  let near = 0;

  for (const p of s) {
    if (
      minRouteDistance(p, lineB) <= threshold
    ) {
      near++;
    }
  }

  return near / s.length;
}

app.post("/api/match", async (req, res) => {

  try {

    const {
      aPickup,
      aDrop,
      bPickup,
      bDrop
    } = req.body || {};

    if (
      ![aPickup, aDrop, bPickup, bDrop]
        .every(
          x =>
            typeof x === "string" &&
            x.trim()
        )
    ) {
      return res.status(400).json({
        error: "Please provide all four locations."
      });
    }

    console.log("Matching journeys:");
    console.log("A:", aPickup, "→", aDrop);
    console.log("B:", bPickup, "→", bDrop);

    const aPickupGeo =
      await geocode(aPickup);

    await sleep(1100);

    const aDropGeo =
      await geocode(aDrop);

    await sleep(1100);

    const bPickupGeo =
      await geocode(bPickup);

    await sleep(1100);

    const bDropGeo =
      await geocode(bDrop);

    const [routeA, routeB] =
      await Promise.all([
        osrmRoute(
          aPickupGeo,
          aDropGeo
        ),
        osrmRoute(
          bPickupGeo,
          bDropGeo
        )
      ]);

    const lineA =
      routeA.geometry.coordinates;

    const lineB =
      routeB.geometry.coordinates;

    const shareAB =
      corridorShare(
        lineA,
        lineB,
        1000
      );

    const shareBA =
      corridorShare(
        lineB,
        lineA,
        1000
      );

    const dirA =
      bearing(
        lineA[0],
        lineA[lineA.length - 1]
      );

    const dirB =
      bearing(
        lineB[0],
        lineB[lineB.length - 1]
      );

    const directionDifference =
      angleDiff(dirA, dirB);

    // CURRENT V0 MATCHING RULE
    const directionOK =
      directionDifference <= 55;

    const corridorOK =
      shareAB >= 0.25 ||
      shareBA >= 0.25 ||
      (
        shareAB >= 0.20 &&
        shareBA >= 0.20
      );

    const matched =
      directionOK && corridorOK;

    res.json({

      matched,

      thresholdMeters: 1000,

      directionDifference,

      shareAB,

      shareBA,

      a: {
        pickup: {
          lat: aPickupGeo.lat,
          lon: aPickupGeo.lon,
          name: aPickup
        },
        drop: {
          lat: aDropGeo.lat,
          lon: aDropGeo.lon,
          name: aDrop
        }
      },

      b: {
        pickup: {
          lat: bPickupGeo.lat,
          lon: bPickupGeo.lon,
          name: bPickup
        },
        drop: {
          lat: bDropGeo.lat,
          lon: bDropGeo.lon,
          name: bDrop
        }
      },

      routeA: routeA.geometry,

      routeB: routeB.geometry,

      rules: {
        directionMaxDegrees: 55,
        minOneWayShare: 0.25,
        twoWayShare: 0.20
      }

    });

  } catch (e) {

    console.error(e);

    res.status(500).json({
      error:
        e.message ||
        "Matching failed."
    });
  }
});

app.get("/{*splat}", (req, res) => {
  res.sendFile(
    path.join(
      __dirname,
      "public",
      "index.html"
    )
  );
});

app.listen(
  PORT,
  () => {
    console.log(
      `GoTogether Route Matcher running at http://localhost:${PORT}`
    );
  }
);