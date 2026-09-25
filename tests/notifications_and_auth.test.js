const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const app = require("../server");

let server;
let baseUrl;

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port;
      baseUrl = `http://localhost:${port}`;
      resolve();
    });
  });
});

test.after(async () => {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Notifications API: Notification generated when Request created & updated", async () => {
  const hostUserId = "u-test-host-" + Date.now();
  const reqUserId = "u-test-req-" + Date.now();

  // 1. Host creates journey
  const hostJourneyRes = await fetch(`${baseUrl}/api/journeys`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      userId: hostUserId,
      name: "Test Host Driver",
      pickup: "Uppal, Hyderabad",
      drop: "Ghatkesar, Hyderabad"
    })
  });
  const hostData = await hostJourneyRes.json();
  assert.equal(hostJourneyRes.ok, true);
  assert.ok(hostData.journey.id);

  // 2. Requester creates request
  const requestRes = await fetch(`${baseUrl}/api/join-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      targetJourneyId: hostData.journey.id,
      requesterId: reqUserId,
      requesterName: "Test Requester",
      pickupName: "Boduppal",
      dropName: "Narapally"
    })
  });
  const requestData = await requestRes.json();
  assert.equal(requestRes.ok, true);
  assert.ok(requestData.request.id);

  // 3. Verify Host receives notification for request_received
  const hostNotifRes = await fetch(`${baseUrl}/api/notifications?userId=${encodeURIComponent(hostUserId)}`);
  const hostNotifData = await hostNotifRes.json();
  assert.equal(hostNotifRes.ok, true);
  assert.ok(hostNotifData.unreadCount >= 1);
  const recNotif = hostNotifData.notifications.find(n => n.type === "request_received");
  assert.ok(recNotif);
  assert.equal(recNotif.user_id, hostUserId);

  // 4. Host accepts request
  const patchRes = await fetch(`${baseUrl}/api/join-requests/${requestData.request.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "accepted",
      userId: hostUserId
    })
  });
  assert.equal(patchRes.ok, true);

  // 5. Verify Requester receives notification for request_accepted
  const reqNotifRes = await fetch(`${baseUrl}/api/notifications?userId=${encodeURIComponent(reqUserId)}`);
  const reqNotifData = await reqNotifRes.json();
  assert.equal(reqNotifRes.ok, true);
  assert.ok(reqNotifData.unreadCount >= 1);
  const accNotif = reqNotifData.notifications.find(n => n.type === "request_accepted");
  assert.ok(accNotif);

  // 6. Mark notifications as read for Requester
  const readRes = await fetch(`${baseUrl}/api/notifications/read`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: reqUserId })
  });
  assert.equal(readRes.ok, true);

  // 7. Verify unread count is 0 after read
  const reqNotifAfterRes = await fetch(`${baseUrl}/api/notifications?userId=${encodeURIComponent(reqUserId)}`);
  const reqNotifAfterData = await reqNotifAfterRes.json();
  assert.equal(reqNotifAfterData.unreadCount, 0);
});
