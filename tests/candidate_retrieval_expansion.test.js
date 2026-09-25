/**
 * Test Suite: Generic Route-Based Candidate Retrieval Expansion
 * Verifies that candidate journeys with pickups farther from origin pickup but along the route
 * are retrieved and evaluated, while unrelated candidates are efficiently excluded.
 */

const assert = require("assert");
const http = require("http");
const app = require("../server.js");

let server;
let baseUrl;

function makeRequest(path, options = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const reqOpts = {
      method: options.method || "GET",
      headers: options.headers || {}
    };

    const req = http.request(url, reqOpts, (res) => {
      let data = "";
      res.on("data", chunk => { data += chunk; });
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, body: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, raw: data });
        }
      });
    });

    req.on("error", reject);

    if (options.body) {
      req.write(JSON.stringify(options.body));
    }
    req.end();
  });
}

async function runTest() {
  console.log("==================================================");
  console.log("RUNNING CANDIDATE RETRIEVAL EXPANSION TEST SUITE");
  console.log("==================================================\n");

  server = app.listen(0, async () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    try {
      // 1. Create Candidate B (Driver B) whose pickup is at Uppal (17.4025, 78.5612) -> Ghatkesar (17.4510, 78.6843)
      const bRes = await makeRequest("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          userId: "u-test-driver-b",
          name: "Driver B",
          pickup: "Uppal, Hyderabad",
          drop: "Ghatkesar, Hyderabad",
          pickupLat: 17.4025,
          pickupLon: 78.5612,
          dropLat: 17.4510,
          dropLon: 78.6843
        }
      });
      assert.strictEqual(bRes.status, 200, "Candidate B creation 200 OK");
      const candidateBId = bRes.body.journey.id;

      // 2. Create Candidate C (Unrelated) whose pickup is at Gachibowli (17.4436, 78.3519) -> Hitech City (17.4696, 78.3851)
      const cRes = await makeRequest("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          userId: "u-test-driver-c",
          name: "Driver C (Unrelated)",
          pickup: "Gachibowli, Hyderabad",
          drop: "Hitech City, Hyderabad",
          pickupLat: 17.4436,
          pickupLon: 78.3519,
          dropLat: 17.4696,
          dropLon: 78.3851
        }
      });
      assert.strictEqual(cRes.status, 200, "Candidate C creation 200 OK");
      const candidateCId = cRes.body.journey.id;

      // 3. User A searches from Nagole (17.3775, 78.5601) -> Ghatkesar (17.4510, 78.6843) with a small searchRadiusKm = 2km
      // Pickup A (Nagole) to Pickup B (Uppal) is ~3.2 km apart (FARTHER than searchRadiusKm = 2km).
      // Under old origin-only pickup retrieval, Driver B would be excluded.
      // Under route-based candidate retrieval, Driver B falls inside User A's route bounding box and is retrieved!
      console.log("Executing match-search for User A (Nagole -> Ghatkesar) with searchRadiusKm = 2...");
      const searchRes = await makeRequest("/api/match-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          requesterUserId: "u-test-user-a",
          requesterName: "Commuter A",
          aPickup: "Nagole, Hyderabad",
          aDrop: "Ghatkesar, Hyderabad",
          aPickupLat: 17.3775,
          aPickupLon: 78.5601,
          aDropLat: 17.4510,
          aDropLon: 78.6843,
          searchRadiusKm: 2
        }
      });

      assert.strictEqual(searchRes.status, 200, "Match search 200 OK");
      const body = searchRes.body;
      assert.strictEqual(body.success, true, "Search success true");

      const matchB = body.matches.find(m => m.id === candidateBId);
      const matchC = body.matches.find(m => m.id === candidateCId);

      console.log(` - Candidate B (Uppal pickup, 3.2km away from Nagole) retrieved & matched: ${Boolean(matchB)}`);
      console.log(` - Candidate C (Gachibowli pickup, 23km away) matched: ${Boolean(matchC)}`);

      assert.ok(matchB, "Candidate B MUST be retrieved and matched because its pickup lies along User A's route polyline bounding box");
      assert.strictEqual(matchB.data.matched, true, "Existing matcher evaluates Candidate B as matched");
      assert.strictEqual(matchC, undefined, "Unrelated Candidate C MUST NOT be returned in final matches");

      console.log("\n [PASS] CANDIDATE RETRIEVAL EXPANSION TEST SUITE COMPLETED SUCCESSFULLY");
      server.close();
      process.exit(0);

    } catch (err) {
      console.error("Test failed:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runTest();
