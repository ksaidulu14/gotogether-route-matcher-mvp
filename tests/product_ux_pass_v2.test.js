const test = require("node:test");
const assert = require("node:assert");

const app = require("../server");
const PORT = 3999;
let server;

test.before(() => {
  return new Promise((resolve) => {
    server = app.listen(PORT, () => {
      console.log(`Test server running on port ${PORT}`);
      resolve();
    });
  });
});

test.after(() => {
  return new Promise((resolve) => {
    server.close(resolve);
  });
});

test("UX Pass: Route discovery before schedule filtering", async () => {
  const testDriverId = `u-driver-${Date.now()}`;
  const testDriverName = `Driver ${Date.now()}`;

  // 1. Create Driver Journey with Date A (e.g. 2026-10-01)
  const driverRes = await fetch(`http://localhost:${PORT}/api/journeys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: testDriverId,
      name: testDriverName,
      pickup: "Uppal, Hyderabad",
      drop: "Ghatkesar, Hyderabad",
      pickupLat: 17.4025,
      pickupLon: 78.5612,
      dropLat: 17.4510,
      dropLon: 78.6843,
      departureDate: "2026-10-01",
      departureTime: "08:30:00"
    })
  });
  const driverData = await driverRes.json();
  assert.strictEqual(driverData.success, true);
  const driverJourneyId = driverData.journey.id;
  console.log("Created Driver Journey:", driverData.journey);

  // 2. Search for Passenger Journey on Date B (e.g. 2026-10-05) on the exact same route corridor
  const searchRes = await fetch(`http://localhost:${PORT}/api/match-search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      aPickup: "Uppal, Hyderabad",
      aDrop: "Ghatkesar, Hyderabad",
      aPickupLat: 17.4025,
      aPickupLon: 78.5612,
      aDropLat: 17.4510,
      aDropLon: 78.6843,
      departureDate: "2026-10-05",
      departureTime: "08:30:00",
      searchRadiusKm: 5,
      includeSeeds: true
    })
  });

  const searchData = await searchRes.json();
  assert.strictEqual(searchData.success, true);
  assert.ok(Array.isArray(searchData.matches));

  // 3. Verify driver's journey IS returned as a match even though dates differ
  const matchedDriver = searchData.matches.find(m => m.id === driverJourneyId || m.journey_id === driverJourneyId);
  console.log("Matched Driver Result:", matchedDriver);
  assert.ok(matchedDriver, "Journey with matching route but different schedule MUST remain discoverable.");
  assert.strictEqual(matchedDriver.scheduleStatus, "different_timing");
  assert.strictEqual(matchedDriver.scheduleDiffers, true);

  // 4. Verify telemetry real candidate count and execution duration
  assert.ok(searchData.timing);
  assert.ok(typeof searchData.timing.totalMs === "number");
  assert.ok(typeof searchData.timing.candidateCount === "number");
  console.log(`[PASS] Telemetry verified: ${searchData.timing.candidateCount} candidates checked in ${searchData.timing.totalMs}ms`);
});
