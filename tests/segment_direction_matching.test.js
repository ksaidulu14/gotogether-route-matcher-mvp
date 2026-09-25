/**
 * Test Suite: Segment-Level Route Direction Matching
 * Verifies that route direction is evaluated specifically along shared road corridors,
 * eliminating false negatives from final/initial destination legs and false positives
 * from reverse-flow shared corridors.
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

async function runTests() {
  console.log("==================================================");
  console.log("RUNNING SEGMENT-LEVEL ROUTE DIRECTION TEST SUITE");
  console.log("==================================================\n");

  server = app.listen(0, async () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    try {
      // Test A: Straight same-direction routes -> MATCH direction
      console.log("Test A: Straight same-direction routes -> MATCH direction");
      const resA = await makeRequest("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          aPickupLat: 17.40, aPickupLon: 78.50,
          aDropLat: 17.40, aDropLon: 78.60,
          bPickupLat: 17.402, bPickupLon: 78.50,
          bDropLat: 17.402, bDropLon: 78.60
        }
      });
      assert.strictEqual(resA.status, 200);
      assert.strictEqual(resA.body.matched, true, "Straight same-direction routes MUST match");
      assert.ok(resA.body.directionDifference <= 55, "directionDifference <= 55°");
      console.log("  [PASS] Test A Passed\n");

      // Test B: Straight opposite-direction routes -> REJECT direction
      console.log("Test B: Straight opposite-direction routes -> REJECT direction");
      const resB = await makeRequest("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          aPickupLat: 17.40, aPickupLon: 78.50,
          aDropLat: 17.40, aDropLon: 78.60,
          bPickupLat: 17.402, bPickupLon: 78.60,
          bDropLat: 17.402, bDropLon: 78.50
        }
      });
      assert.strictEqual(resB.status, 200);
      assert.strictEqual(resB.body.matched, false, "Straight opposite-direction routes MUST NOT match");
      console.log("  [PASS] Test B Passed\n");

      // Test C: Curved route with long same-direction shared corridor but different final destination leg -> ACCEPT direction
      // (Former Scenario 3 False Negative case)
      console.log("Test C: Curved route with long same-direction shared corridor -> ACCEPT direction");
      const resC = await makeRequest("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          aPickupLat: 17.3775, aPickupLon: 78.5601,
          aDropLat: 17.4510, aDropLon: 78.6843,
          bPickupLat: 17.4025, bPickupLon: 78.5612,
          bDropLat: 17.4510, bDropLon: 78.6843
        }
      });
      assert.strictEqual(resC.status, 200);
      assert.strictEqual(resC.body.directionDifference <= 55, true, "Segment-level direction along shared corridor MUST be <= 55°");
      assert.strictEqual(resC.body.matched, true, "Curved route with shared same-direction corridor MUST match");
      console.log("  [PASS] Test C Passed (False Negative Fixed)\n");

      // Test D: U-shaped / opposite-flow shared corridor -> REJECT direction
      // (Former Scenario 4 False Positive case)
      console.log("Test D: Opposite-flow shared corridor -> REJECT direction");
      const resD = await makeRequest("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          aPickupLat: 17.40, aPickupLon: 78.50,
          aDropLat: 17.55, aDropLon: 78.60,
          bPickupLat: 17.42, bPickupLon: 78.60,
          bDropLat: 17.65, bDropLon: 78.50
        }
      });
      assert.strictEqual(resD.status, 200);
      assert.strictEqual(resD.body.matched, false, "Opposite-flow shared corridor MUST NOT match");
      console.log("  [PASS] Test D Passed (False Positive Fixed)\n");

      // Test E: No shared corridor -> REJECT via corridorShare
      console.log("Test E: No shared corridor -> REJECT via corridorShare");
      const resE = await makeRequest("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          aPickupLat: 17.4436, aPickupLon: 78.3519,
          aDropLat: 17.4696, aDropLon: 78.3851,
          bPickupLat: 17.4180, bPickupLon: 78.6323,
          bDropLat: 17.5840, bDropLon: 78.9467
        }
      });
      assert.strictEqual(resE.status, 200);
      assert.strictEqual(resE.body.matched, false, "Routes with no shared corridor MUST NOT match");
      console.log("  [PASS] Test E Passed\n");

      console.log("==================================================");
      console.log("SEGMENT-LEVEL ROUTE DIRECTION TEST SUITE PASSED!");
      console.log("==================================================");

      server.close();
      process.exit(0);

    } catch (err) {
      console.error("Test execution failed:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runTests();
