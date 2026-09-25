/**
 * Test Suite: Real User Flow End-to-End Test
 * Tests Auth, Journey creation, Route Matching, Interactive Request & Cancellation,
 * Accept Flow, Restricted Chat, Predefined Messages, and Conversations Menu.
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

async function runRealUserFlowTest() {
  console.log("==================================================");
  console.log("RUNNING REAL USER FLOW END-TO-END TEST SUITE");
  console.log("==================================================\n");

  server = app.listen(0, async () => {
    const port = server.address().port;
    baseUrl = `http://localhost:${port}`;

    try {
      // 1. Auth: Sign In User A & User B
      console.log("1. Authenticating User A and User B...");
      const authA = await makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { name: "User A (Commuter)", email: "user.a@example.com" }
      });
      assert.strictEqual(authA.status, 200, "User A Auth 200 OK");
      const userA = authA.body.profile;

      const authB = await makeRequest("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { name: "User B (Host)", email: "user.b@example.com" }
      });
      assert.strictEqual(authB.status, 200, "User B Auth 200 OK");
      const userB = authB.body.profile;

      console.log(` - User A ID: ${userA.id}, Name: ${userA.name}`);
      console.log(` - User B ID: ${userB.id}, Name: ${userB.name}`);

      // 2. Create Journey A & Journey B (Test mode header avoids DB pollution)
      console.log("\n2. Creating Journey A (Nagole -> Ghatkesar) & Journey B (Uppal -> Ghatkesar)...");
      const jA = await makeRequest("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-mode": "true" },
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
      assert.strictEqual(jA.status, 200, "Journey A creation 200 OK");
      const journeyA = jA.body.journey;

      const jB = await makeRequest("/api/journeys", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-mode": "true" },
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
      assert.strictEqual(jB.status, 200, "Journey B creation 200 OK");
      const journeyB = jB.body.journey;

      console.log(` - Journey A ID: ${journeyA.id}`);
      console.log(` - Journey B ID: ${journeyB.id}`);

      // 3. Search & Match: User A searches for matches
      console.log("\n3. Executing match-search for User A...");
      const searchRes = await makeRequest("/api/match-search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          requesterUserId: userA.id,
          requesterJourneyId: journeyA.id,
          requesterName: userA.name,
          aPickup: "Nagole, Hyderabad",
          aDrop: "Ghatkesar, Hyderabad",
          aPickupLat: 17.3775,
          aPickupLon: 78.5601,
          aDropLat: 17.4510,
          aDropLon: 78.6843,
          searchRadiusKm: 5,
          includeSeeds: true
        }
      });
      assert.strictEqual(searchRes.status, 200, "Match search 200 OK");
      const matchB = searchRes.body.matches.find(m => m.id === journeyB.id || m.user_id === userB.id);
      assert.ok(matchB, "Journey B must be found as a match for Journey A");
      console.log(` - Match found: ${matchB.name}, Match score: ${matchB.data.routeMatchPercent}%`);

      // 4. Request & Cancellation Lifecycle
      console.log("\n4. Testing Request & Cancel Lifecycle...");
      const req1 = await makeRequest("/api/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          targetJourneyId: journeyB.id,
          requesterJourneyId: journeyA.id,
          requesterId: userA.id,
          requesterName: userA.name,
          pickupName: "Nagole",
          dropName: "Ghatkesar"
        }
      });
      assert.strictEqual(req1.status, 200, "Create request 200 OK");
      const request1 = req1.body.request;
      console.log(` - Request sent (ID: ${request1.id}, Status: ${request1.status})`);

      // Cancel Request 1
      const cancelRes = await makeRequest(`/api/join-requests/${request1.id}`, {
        method: "DELETE"
      });
      assert.strictEqual(cancelRes.status, 200, "Cancel request 200 OK");
      console.log(` - Request cancelled successfully`);

      // Re-send Request 2
      const req2 = await makeRequest("/api/join-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          targetJourneyId: journeyB.id,
          requesterJourneyId: journeyA.id,
          requesterId: userA.id,
          requesterName: userA.name,
          pickupName: "Nagole",
          dropName: "Ghatkesar"
        }
      });
      assert.strictEqual(req2.status, 200, "Re-send request 200 OK");
      const activeRequest = req2.body.request;
      console.log(` - Re-sent Request ID: ${activeRequest.id}, Status: ${activeRequest.status}`);

      // 5. Host Accepts Request
      console.log("\n5. User B accepts the request...");
      const acceptRes = await makeRequest(`/api/join-requests/${activeRequest.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: {
          status: "accepted",
          userId: userB.id,
          userJourneyId: journeyB.id
        }
      });
      assert.strictEqual(acceptRes.status, 200, "Accept request 200 OK");
      assert.strictEqual(acceptRes.body.request.status, "accepted", "Status is accepted");
      console.log(` - Request status updated to: ${acceptRes.body.request.status}`);

      // 6. Verify Restricted Chat Access & Messaging
      console.log("\n6. Accessing conversation & sending predefined messages...");
      const convResA = await makeRequest(`/api/conversations/${activeRequest.id}?userId=${userA.id}`);
      assert.strictEqual(convResA.status, 200, "User A conversation access 200 OK");
      const conv = convResA.body.conversation;
      console.log(` - Conversation ID: ${conv.id}`);

      // User A sends predefined message: "where_meet" ("Where should we meet?")
      const msg1 = await makeRequest(`/api/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          senderId: userA.id,
          senderName: userA.name,
          quickMessageKey: "where_meet"
        }
      });
      assert.strictEqual(msg1.status, 200, "User A send quick message 200 OK");
      console.log(` - User A sent: "${msg1.body.message.quick_message_text}"`);

      // User B sends predefined reply: "near_metro" ("Can we meet near the metro?")
      const msg2 = await makeRequest(`/api/conversations/${conv.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          senderId: userB.id,
          senderName: userB.name,
          quickMessageKey: "near_metro"
        }
      });
      assert.strictEqual(msg2.status, 200, "User B send quick reply 200 OK");
      console.log(` - User B replied: "${msg2.body.message.quick_message_text}"`);

      // User B reads conversation messages
      const convResB = await makeRequest(`/api/conversations/${activeRequest.id}?userId=${userB.id}`);
      assert.strictEqual(convResB.status, 200, "User B conversation access 200 OK");
      assert.strictEqual(convResB.body.messages.length, 2, "Both messages visible in conversation");
      console.log(` - Both messages verified in conversation history (Count: ${convResB.body.messages.length})`);

      // 7. Verify Conversations Menu API for User A and User B
      console.log("\n7. Fetching Conversations menu for User A and User B...");
      const userAConvs = await makeRequest(`/api/conversations?userId=${userA.id}`);
      assert.strictEqual(userAConvs.status, 200, "User A conversations list 200 OK");
      assert.ok(userAConvs.body.conversations.length > 0, "User A sees active chat in Conversations list");

      const userBConvs = await makeRequest(`/api/conversations?userId=${userB.id}`);
      assert.strictEqual(userBConvs.status, 200, "User B conversations list 200 OK");
      assert.ok(userBConvs.body.conversations.length > 0, "User B sees active chat in Conversations list");
      console.log(` - User A active conversations: ${userAConvs.body.conversations.length}`);
      console.log(` - User B active conversations: ${userBConvs.body.conversations.length}`);

      console.log("\n==================================================");
      console.log("[PASS] REAL USER FLOW TEST SUITE PASSED SUCCESSFULLY!");
      console.log("==================================================\n");

      server.close();
      process.exit(0);

    } catch (err) {
      console.error("\n[FAIL] Test suite error:", err);
      if (server) server.close();
      process.exit(1);
    }
  });
}

runRealUserFlowTest();
