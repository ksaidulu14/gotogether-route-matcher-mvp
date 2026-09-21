/**
 * Route Matching Adapter
 * Bridges OSRM route geometries into match evaluations without modifying core server logic.
 */

const { computeDynamicMeetingData } = require('./dynamic_meeting');

/**
 * Prepares match evaluation payload enriched with dynamic meeting points and geometry slices.
 */
function adaptRouteForMatching(userJourney, candidateJourney, userRouteGeom, candidateRouteGeom) {
  const dynamicMeeting = computeDynamicMeetingData(
    userRouteGeom,
    candidateRouteGeom,
    { lat: userJourney.a_pickup_lat, lon: userJourney.a_pickup_lon },
    { lat: userJourney.a_drop_lat, lon: userJourney.a_drop_lon }
  );

  return {
    candidateId: candidateJourney.id,
    userRouteGeometry: userRouteGeom,
    candidateRouteGeometry: candidateRouteGeom,
    sharedGeometry: dynamicMeeting.sharedGeometry,
    meetingPoint: dynamicMeeting.meetingPoint,
    dropoffMeetingPoint: dynamicMeeting.dropoffMeetingPoint,
    sharedDistanceKm: dynamicMeeting.sharedDistanceKm
  };
}

module.exports = {
  adaptRouteForMatching
};
