/**
 * GoTogether Route Matcher MVP v2 — Focused Test Suite
 * Requests Sent vs Requests Received Isolation & Authorization Security
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
  console.log("RUNNING FOCUSED REQUESTS SENT VS RECEIVED SUITE");
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
      // Setup authenticated users
      const userA = { id: "u-user-A", name: "Sumanth (Requester)" };
      const userB = { id: "u-user-B", name: "Anjan (Host Driver)" };
      const userC = { id: "u-user-C", name: "Malicious User C" };

      let journeyBId;
      let journeyAId;
      let joinRequestId;

      // 1. User B (Host) creates journey
      await test("Step 1: User B (Anjan) Creates Journey", async () => {
        const res = await makeRequest("/api/journeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            userId: userB.id,
            name: userB.name,
            pickup: "Uppal, Hyderabad",
            drop: "Ghatkesar, Hyderabad",
            pickupLat: 17.4025,
            pickupLon: 78.5612,
            dropLat: 17.4510,
            dropLon: 78.6843
          }
        });

        assert.strictEqual(res.status, 200, "User B journey creation status 200");
        assert.ok(res.body.journey.id, "Journey B ID generated");
        journeyBId = res.body.journey.id;
      });

      // User A (Requester) creates journey
      await test("Step 2: User A (Sumanth) Creates Journey", async () => {
        const res = await makeRequest("/api/journeys", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            userId: userA.id,
            name: userA.name,
            pickup: "Nagole, Hyderabad",
            drop: "Ghatkesar, Hyderabad",
            pickupLat: 17.3775,
            pickupLon: 78.5601,
            dropLat: 17.4510,
            dropLon: 78.6843
          }
        });

        assert.strictEqual(res.status, 200, "User A journey creation status 200");
        assert.ok(res.body.journey.id, "Journey A ID generated");
        journeyAId = res.body.journey.id;
      });

      // 3. User A sends request to User B's journey
      await test("Step 3: User A Sends Request to User B's Journey", async () => {
        const res = await makeRequest("/api/join-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            targetJourneyId: journeyBId,
            requesterJourneyId: journeyAId,
            requesterId: userA.id,
            requesterName: userA.name,
            pickupName: "Nagole",
            dropName: "Ghatkesar"
          }
        });

        assert.strictEqual(res.status, 200, "Join request created");
        assert.ok(res.body.request.id, "Request ID exists");
        assert.strictEqual(res.body.request.status, "pending", "Status is pending");
        joinRequestId = res.body.request.id;
      });

      // VERIFY USER A: Requests Sent
      await test("Verification 3a: USER A (Sumanth) Sees Request under REQUESTS SENT Only", async () => {
        const resSent = await makeRequest(`/api/join-requests?type=sent&userId=${userA.id}&journeyId=${journeyAId}`);
        assert.strictEqual(resSent.status, 200, "Fetch sent requests HTTP 200");
        assert.strictEqual(resSent.body.requests.length, 1, "User A has 1 sent request");
        assert.strictEqual(resSent.body.requests[0].id, joinRequestId, "Matches joinRequestId");
        assert.strictEqual(resSent.body.requests[0].status, "pending", "Status is pending (Waiting for response)");

        const resReceived = await makeRequest(`/api/join-requests?type=received&userId=${userA.id}&journeyId=${journeyAId}`);
        assert.strictEqual(resReceived.body.requests.length, 0, "User A must have 0 received requests");
      });

      // VERIFY USER B: Requests Received
      await test("Verification 3b: USER B (Anjan) Sees Request under REQUESTS RECEIVED Only", async () => {
        const resReceived = await makeRequest(`/api/join-requests?type=received&userId=${userB.id}&journeyId=${journeyBId}`);
        assert.strictEqual(resReceived.status, 200, "Fetch received requests HTTP 200");
        assert.strictEqual(resReceived.body.requests.length, 1, "User B has 1 received request");
        assert.strictEqual(resReceived.body.requests[0].id, joinRequestId, "Matches joinRequestId");
        assert.strictEqual(resReceived.body.requests[0].requester_name, userA.name, "Requester name is Sumanth");
        assert.strictEqual(resReceived.body.requests[0].status, "pending", "Status is pending (Accept/Decline available)");

        const resSent = await makeRequest(`/api/join-requests?type=sent&userId=${userB.id}&journeyId=${journeyBId}`);
        assert.strictEqual(resSent.body.requests.length, 0, "User B must have 0 sent requests");
      });

      // SECURITY 6: User C cannot accept request
      await test("Security Check 6: Unrelated User C CANNOT Accept Request", async () => {
        const res = await makeRequest(`/api/join-requests/${joinRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { status: "accepted", userId: userC.id, userJourneyId: "j-unrelated-c" }
        });

        assert.strictEqual(res.status, 403, "User C must receive HTTP 403 Forbidden");
        assert.ok(res.body.error.includes("journey host"), "Error mentions journey host required");
      });

      // SECURITY 7: User A (Requester) cannot accept their own request
      await test("Security Check 7: User A (Requester) CANNOT Accept Their Own Request", async () => {
        const res = await makeRequest(`/api/join-requests/${joinRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { status: "accepted", userId: userA.id, userJourneyId: journeyAId }
        });

        assert.strictEqual(res.status, 403, "Requester must receive HTTP 403 Forbidden");
        assert.ok(res.body.error.includes("Requesters cannot accept"), "Error specifies requesters cannot accept");
      });

      // 4. User B (Host) accepts request
      await test("Step 4: User B (Anjan / Host) Clicks Accept", async () => {
        const res = await makeRequest(`/api/join-requests/${joinRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { status: "accepted", userId: userB.id, userJourneyId: journeyBId }
        });

        assert.strictEqual(res.status, 200, "Accept request status HTTP 200");
        assert.strictEqual(res.body.request.status, "accepted", "Status is now accepted");
      });

      // 5. User A and User B both get chat access
      await test("Step 5: Both User A (Requester) and User B (Host) Receive Chat Access", async () => {
        const resA = await makeRequest(`/api/conversations/${joinRequestId}?userId=${userA.id}`);
        assert.strictEqual(resA.status, 200, "User A gets chat access");
        assert.ok(resA.body.conversation.id, "User A conversation ID exists");

        const resB = await makeRequest(`/api/conversations/${joinRequestId}?userId=${userB.id}`);
        assert.strictEqual(resB.status, 200, "User B gets chat access");
        assert.strictEqual(resA.body.conversation.id, resB.body.conversation.id, "Both users access exact same conversation");
      });

      // SECURITY 8: Duplicate acceptance does not create duplicate conversations
      await test("Security Check 8: Duplicate Acceptance Does Not Create Duplicate Conversations", async () => {
        const res1 = await makeRequest(`/api/conversations/${joinRequestId}?userId=${userB.id}`);
        const res2 = await makeRequest(`/api/conversations/${joinRequestId}?userId=${userB.id}`);
        assert.strictEqual(res1.body.conversation.id, res2.body.conversation.id, "Conversation IDs must be identical");
      });

      // SECURITY 9: Rejected request does not expose chat
      let rejRequestId;
      await test("Security Check 9: Rejected Request Does NOT Expose Chat", async () => {
        // Create another request
        const createRes = await makeRequest("/api/join-requests", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: {
            targetJourneyId: journeyBId,
            requesterJourneyId: journeyAId,
            requesterId: userA.id,
            requesterName: "Test Requester",
            pickupName: "Pickup",
            dropName: "Drop"
          }
        });

        rejRequestId = createRes.body.request.id;

        // User B declines request
        const decRes = await makeRequest(`/api/join-requests/${rejRequestId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: { status: "rejected", userId: userB.id, userJourneyId: journeyBId }
        });
        assert.strictEqual(decRes.body.request.status, "rejected", "Status is rejected");

        // Attempt chat fetch
        const chatRes = await makeRequest(`/api/conversations/${rejRequestId}?userId=${userB.id}`);
        assert.strictEqual(chatRes.status, 403, "Rejected request chat fetch must return HTTP 403 Forbidden");
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
