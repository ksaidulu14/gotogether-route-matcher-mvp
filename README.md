# GoTogether Route Matcher MVP v2

This is a tiny local web app, not the full GoTogetherRides product.

## Run
1. Install Node.js 18+.
2. Open a terminal in this folder.
3. Run:
   npm install
   npm start
4. Open http://localhost:3000

## Test
Journey A: Nagole, Hyderabad -> Ghatkesar, Hyderabad
Journey B: Uppal, Hyderabad -> Ghatkesar, Hyderabad

## What is real?
- User-entered locations are geocoded through Nominatim/OpenStreetMap.
- Routes are calculated through OSRM using the real road network.
- The matching decision uses the returned road geometry.

## V0 matching logic
- Direction difference <= 55 degrees
- AND at least 25% of one route is within 1 km of the other,
  OR both routes have at least 20% corridor sharing.

These thresholds are intentionally just a starting point. The next phase is to test real journeys and tune the algorithm.

## Important
The public Nominatim and OSRM services are for experimentation and have usage/policy limits. Do not treat them as a production SLA. For production, use an appropriate routing/geocoding provider or self-host the relevant services, and comply with OpenStreetMap attribution/licensing requirements.
