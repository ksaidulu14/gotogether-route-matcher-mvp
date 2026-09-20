if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch (e) {
    // Environment variables loaded from process env
  }
}

const supabase = require("../lib/supabase");

function rad(x) {
  return (x * Math.PI) / 180;
}

function calculateBearing(a, b) {
  const p1 = rad(a[1]);
  const p2 = rad(b[1]);
  const dl = rad(b[0] - a[0]);

  const y = Math.sin(dl) * Math.cos(p2);
  const x =
    Math.cos(p1) * Math.sin(p2) -
    Math.sin(p1) * Math.cos(p2) * Math.cos(dl);

  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

async function osrmRoute(a, b) {
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${a.lon},${a.lat};${b.lon},${b.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Routing failed: ${response.status}`);
  }
  const data = await response.json();
  if (data.code !== "Ok" || !data.routes || !data.routes.length) {
    throw new Error("No driving route found.");
  }
  return data.routes[0];
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function backfill() {
  console.log("Starting backfill for journeys table...");

  const { data: journeys, error } = await supabase
    .from("journeys")
    .select("*");

  if (error) {
    console.error("Error fetching journeys:", error);
    process.exit(1);
  }

  console.log(`Found ${journeys.length} total journeys.`);

  let updatedCount = 0;

  for (const journey of journeys) {
    try {
      if (journey.route_geojson && journey.bearing_degrees !== null && journey.bearing_degrees !== undefined) {
        console.log(`[Skipped] Journey ${journey.id} already has precomputed geometry.`);
        continue;
      }

      console.log(`[Processing] Precomputing geometry for Journey ${journey.id} (${journey.pickup_name} -> ${journey.drop_name})...`);

      const aGeo = { lat: journey.pickup_lat, lon: journey.pickup_lon };
      const bGeo = { lat: journey.drop_lat, lon: journey.drop_lon };

      const route = await osrmRoute(aGeo, bGeo);
      const coords = route.geometry.coordinates;
      const startPoint = coords[0];
      const endPoint = coords[coords.length - 1];

      const bearingVal = calculateBearing(startPoint, endPoint);
      const distanceMeters = route.distance || 0;

      const updatePayload = {
        route_geojson: route.geometry,
        route_distance_meters: distanceMeters,
        bearing_degrees: Math.round(bearingVal * 100) / 100
      };

      const { error: updateError } = await supabase
        .from("journeys")
        .update(updatePayload)
        .eq("id", journey.id);

      if (updateError) {
        console.error(`Failed to update journey ${journey.id}:`, updateError.message);
      } else {
        console.log(`[Success] Updated journey ${journey.id} with bearing ${Math.round(bearingVal)} deg, distance ${(distanceMeters/1000).toFixed(1)} km.`);
        updatedCount++;
      }

      await sleep(500); // Rate limit OSRM calls
    } catch (err) {
      console.error(`Error processing journey ${journey.id}:`, err.message);
    }
  }

  console.log(`Backfill complete. Updated ${updatedCount} journeys.`);
  process.exit(0);
}

backfill();
