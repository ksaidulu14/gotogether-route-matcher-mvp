/**
 * GoTogetherRides Dynamic Meeting Point & Shared Geometry Calculator
 * Computes meeting locations dynamically from route geometry without any hardcoded geography.
 */

/**
 * Calculates haversine distance between two [lat, lon] points in kilometers.
 */
function haversineKm(p1, p2) {
  const R = 6371;
  const dLat = (p2[0] - p1[0]) * Math.PI / 180;
  const dLon = (p2[1] - p1[1]) * Math.PI / 180;
  const lat1 = p1[0] * Math.PI / 180;
  const lat2 = p2[0] * Math.PI / 180;

  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1) * Math.cos(lat2) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Finds the point on a segment [A, B] closest to point P [lat, lon].
 */
function closestPointOnSegment(P, A, B) {
  const [px, py] = P;
  const [ax, ay] = A;
  const [bx, by] = B;

  const dx = bx - ax;
  const dy = by - ay;

  if (dx === 0 && dy === 0) return A;

  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return [ax + t * dx, ay + t * dy];
}

/**
 * Finds the closest point on a full polyline geometry to target point P.
 */
function findClosestPointOnPolyline(targetPoint, polyline) {
  if (!polyline || polyline.length === 0) return { point: targetPoint, distanceKm: 0, index: 0 };
  if (polyline.length === 1) return { point: polyline[0], distanceKm: haversineKm(targetPoint, polyline[0]), index: 0 };

  let minDistance = Infinity;
  let bestPoint = polyline[0];
  let bestSegmentIndex = 0;

  for (let i = 0; i < polyline.length - 1; i++) {
    const proj = closestPointOnSegment(targetPoint, polyline[i], polyline[i + 1]);
    const dist = haversineKm(targetPoint, proj);
    if (dist < minDistance) {
      minDistance = dist;
      bestPoint = proj;
      bestSegmentIndex = i;
    }
  }

  return {
    point: bestPoint,
    distanceKm: minDistance,
    segmentIndex: bestSegmentIndex
  };
}

/**
 * Dynamically computes pickup meeting point, dropoff meeting point, and shared geometry overlay.
 * @param {Array<[number, number]>} userRouteGeom - User's route polyline [[lat, lon], ...]
 * @param {Array<[number, number]>} candidateRouteGeom - Candidate's route polyline [[lat, lon], ...]
 * @param {Object} userPickup - { lat, lon }
 * @param {Object} userDrop - { lat, lon }
 */
function computeDynamicMeetingData(userRouteGeom, candidateRouteGeom, userPickup, userDrop) {
  const uPickupPt = [userPickup.latitude ?? userPickup.lat, userPickup.longitude ?? userPickup.lon ?? userPickup.lng];
  const uDropPt = [userDrop.latitude ?? userDrop.lat, userDrop.longitude ?? userDrop.lon ?? userDrop.lng];

  // Project user pickup onto candidate route
  const pickupProjection = findClosestPointOnPolyline(uPickupPt, candidateRouteGeom);
  // Project user drop onto candidate route
  const dropProjection = findClosestPointOnPolyline(uDropPt, candidateRouteGeom);

  // Shared geometry slice on candidate route between pickup projection and drop projection
  let sharedGeometry = [];
  if (candidateRouteGeom && candidateRouteGeom.length >= 2) {
    const idx1 = Math.min(pickupProjection.segmentIndex, dropProjection.segmentIndex);
    const idx2 = Math.max(pickupProjection.segmentIndex, dropProjection.segmentIndex);
    
    sharedGeometry = [pickupProjection.point];
    for (let i = idx1 + 1; i <= idx2; i++) {
      sharedGeometry.push(candidateRouteGeom[i]);
    }
    sharedGeometry.push(dropProjection.point);
  } else {
    sharedGeometry = [pickupProjection.point, dropProjection.point];
  }

  // Calculate total shared distance along shared polyline
  let sharedDistanceKm = 0;
  for (let i = 0; i < sharedGeometry.length - 1; i++) {
    sharedDistanceKm += haversineKm(sharedGeometry[i], sharedGeometry[i + 1]);
  }

  return {
    meetingPoint: {
      latitude: pickupProjection.point[0],
      longitude: pickupProjection.point[1],
      distanceFromUserPickupKm: pickupProjection.distanceKm
    },
    dropoffMeetingPoint: {
      latitude: dropProjection.point[0],
      longitude: dropProjection.point[1],
      distanceFromUserDropKm: dropProjection.distanceKm
    },
    sharedGeometry,
    sharedDistanceKm: Math.round(sharedDistanceKm * 10) / 10
  };
}

module.exports = {
  haversineKm,
  findClosestPointOnPolyline,
  computeDynamicMeetingData
};
