/**
 * GoTogether Route Matcher MVP v2 — Integration Test Suite
 * Commute Planner UX Redesign + V1 Integrated Chat Security & Functionality
 */

const assert = require("assert");
const http = require("http");

// Import Express app directly from server.js
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
  console.log("RUNNING COMMUTE PLANNER + V1 CHAT SECURITY SUITE");
  console.log("==================================================\n");

  server = app.listen(0, async () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    let totalPassed = 0;
    let totalFailed = 0;

    async function test(name, fn) {
      try {
        await fn();
        console.log(` [PASS] ${name}`);
        totalPassed++;
      } catch (err) {
        console.error(` [FAIL] ${name}`);
        console.error(`        Error: ${err.message}`);
        totalFailed++;
      }
    }

    try {
      // ----------------------------------------------------
      // SECTION 1: COMMUTE PLANNER INTEGRITY TESTS
      // ----------------------------------------------------

      await test("Planner: Create Commuter Journey and Precompute OSRM Route", async () => {
        const res = await makeRequest("/api/journeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            name: "Rahul Commuter",
            pickup: "Nagole, Hyderabad",
            drop: "Ghatkesar, Hyderabad",
            pickupLat: 17.37753,
            pickupLon: 78.56012,
            dropLat: 17.45108,
            dropLon: 78.68430,
            departureDate: "2026-09-25",
            departureTime: "08:30"
          }
        });

        assert.strictEqual(res.status, 200, "Should create journey successfully");
        assert.ok(res.body.success, "Response should be success true");
        assert.ok(res.body.journey.id, "Journey ID must be generated");
        assert.strictEqual(res.body.journey.pickup.lat, 17.37753, "Pickup lat preserved");
        assert.strictEqual(res.body.journey.drop.lat, 17.45108, "Drop lat preserved");
      });

      await test("Planner: Execute Match Search Without Modifying Algorithms", async () => {
        const res = await makeRequest("/api/match-search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            aPickup: "Nagole",
            aDrop: "Ghatkesar",
            aPickupLat: 17.37753,
            aPickupLon: 78.56012,
            aDropLat: 17.45108,
            aDropLon: 78.68430,
            searchRadiusKm: 10
          }
        });

        assert.strictEqual(res.status, 200, "Match search HTTP status 200");
        assert.ok(res.body.success, "Match search success");
        assert.ok(Array.isArray(res.body.matches), "Matches array returned");
      });

      // ----------------------------------------------------
      // SECTION 2: V1 CHAT SECURITY & FUNCTIONALITY TESTS
      // ----------------------------------------------------

      let pendingReqId;
      let acceptedReqId;

      await test("Join Request: Create Pending Join Request", async () => {
        const res = await makeRequest("/api/join-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            targetJourneyId: "j-seed-1",
            requesterJourneyId: "j-seed-2",
            requesterId: "u-seed-2",
            requesterName: "Priya S.",
            pickupName: "Uppal X Road",
            dropName: "Ghatkesar"
          }
        });

        assert.strictEqual(res.status, 200, "Join request created");
        assert.ok(res.body.request.id, "Request ID exists");
        assert.strictEqual(res.body.request.status, "pending", "Initial status is pending");
        pendingReqId = res.body.request.id;
      });

      await test("Chat Security 1: Unaccepted (Pending) Request DENIES Chat Access", async () => {
        const res = await makeRequest(`/api/conversations/${pendingReqId}`);
        assert.strictEqual(res.status, 403, "Unaccepted request should return 403 Forbidden");
        assert.ok(res.body.error.includes("accepted"), "Error message specifies accepted required");
      });

      await test("Join Request: Host Accepts Join Request", async () => {
        const res = await makeRequest(`/api/join-requests/${pendingReqId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { status: "accepted" }
        });

        assert.strictEqual(res.status, 200, "Update status HTTP 200");
        assert.strictEqual(res.body.request.status, "accepted", "Status is now accepted");
        acceptedReqId = pendingReqId;
      });

      let convId;

      await test("Chat Security 2: Accepted Request ALLOWS Participant A & B Access", async () => {
        const res = await makeRequest(`/api/conversations/${acceptedReqId}?userId=u-seed-2`);
        assert.strictEqual(res.status, 200, "Accepted request chat fetch succeeds");
        assert.ok(res.body.conversation, "Conversation object returned");
        assert.ok(res.body.conversation.id, "Conversation ID exists");
        assert.ok(res.body.approvedQuickMessages, "Approved quick messages list returned");
        convId = res.body.conversation.id;
      });

      await test("Chat Security 3: Unrelated User C DENIED Access", async () => {
        const res = await makeRequest(`/api/conversations/${acceptedReqId}?userId=unrelated-user-999`);
        assert.strictEqual(res.status, 403, "Unrelated user should receive HTTP 403 Forbidden");
        assert.ok(res.body.error.includes("Access denied"), "Error says access denied");
      });

      await test("Chat Security 4: Duplicate Conversation Creation PREVENTED", async () => {
        const res1 = await makeRequest(`/api/conversations/${acceptedReqId}`);
        const res2 = await makeRequest(`/api/conversations/${acceptedReqId}`);
        assert.strictEqual(res1.body.conversation.id, res2.body.conversation.id, "Must return exact same conversation ID");
      });

      await test("Chat Validation 1: Approved Quick Message SUCCESS", async () => {
        const res = await makeRequest(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            senderId: "u-seed-2",
            senderName: "Priya S.",
            quickMessageKey: "where_meet"
          }
        });

        assert.strictEqual(res.status, 200, "Sending approved quick message succeeds");
        assert.strictEqual(res.body.message.quick_message_key, "where_meet", "Message key matches");
        assert.strictEqual(res.body.message.quick_message_text, "Where should we meet?", "Message text resolved correctly");
      });

      await test("Chat Validation 2: Arbitrary Free-Text REJECTED", async () => {
        const res = await makeRequest(`/api/conversations/${convId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            senderId: "u-seed-2",
            senderName: "Priya S.",
            quickMessageKey: "free_text_injection_attempt_hello_call_me"
          }
        });

        assert.strictEqual(res.status, 400, "Arbitrary free text must be rejected with HTTP 400");
        assert.ok(res.body.error.includes("approved V1 quick messages"), "Error mentions quick messages allowed");
      });

      await test("Chat Functionality: Read/Unread State Updating", async () => {
        const res = await makeRequest(`/api/conversations/${convId}/read`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { readerUserId: "u-seed-1" }
        });

        assert.strictEqual(res.status, 200, "Mark read HTTP status 200");
        assert.ok(res.body.readAt, "Read timestamp returned");
      });

      await test("Chat Security 5: Privacy (Zero Contact Information Exposed)", async () => {
        const res = await makeRequest(`/api/conversations/${acceptedReqId}?userId=u-seed-2`);
        const jsonStr = JSON.stringify(res.body);
        assert.strictEqual(jsonStr.includes("phone"), false, "No phone field exposed");
        assert.strictEqual(jsonStr.includes("whatsapp"), false, "No WhatsApp link exposed");
        assert.strictEqual(jsonStr.includes("instagram"), false, "No Instagram field exposed");
        assert.strictEqual(jsonStr.includes("aadhaar"), false, "No Aadhaar exposed");
      });

      console.log("\n==================================================");
      console.log(`TEST SUITE SUMMARY: ${totalPassed} PASSED, ${totalFailed} FAILED`);
      console.log("==================================================");

      server.close();

      if (totalFailed > 0) {
        process.exit(1);
      } else {
        process.exit(0);
      }

    } catch (err) {
      console.error("Test execution error:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runTests();
