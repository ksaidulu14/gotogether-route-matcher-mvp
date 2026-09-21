# Production Migration Plan: GoTogether Open Map Infrastructure

This document outlines the step-by-step migration plan to transition production from Leaflet + static tiles to MapLibre GL JS + PMTiles + OSRM + Provider-Independent Geocoding.

---

## Phase 1: Parallel Foundation (Current State)
- Existing production matching logic, APIs, and UI (`public/index.html`) remain unchanged and fully operational (`commit 1609a13`).
- New open map infrastructure implemented alongside under `lib/`, `public/map/`, `scripts/maps/`, and `tests/maps/`.
- Prototype tested at `/map/index.html`.

---

## Phase 2: Feature Flagged Preview
1. Expose `/map` route or enable a query parameter (`?use_open_map=1`) on staging/preview.
2. Route autocomplete requests through `lib/geocoding` abstraction.
3. Route journey creation through `lib/routing` abstraction.
4. Verify dynamic meeting point generation across 50+ real-world journey pairs.

---

## Phase 3: Backend & Provider Switch
1. Provision self-hosted OSRM container (or configure private OSRM endpoint in `.env`).
2. Set environment variables on Vercel/Production:
   ```env
   GEOCODER_PROVIDER=nominatim
   GEOCODER_BASE_URL=https://nominatim.openstreetmap.org
   OSRM_BASE_URL=https://router.project-osrm.org
   MAP_PROVIDER=maplibre
   PMTILES_URL=/map/hyderabad.pmtiles
   ```
3. Run accuracy benchmark script against production endpoint:
   ```bash
   node scripts/maps/run_benchmark.js
   ```

---

## Phase 4: Production Switch & Rollback Strategy
1. Swap Leaflet renderer in `public/index.html` to MapLibre GL JS + PMTiles protocol.
2. Maintain standard Leaflet fallback option in frontend bundle via feature toggle.
3. Perform live production verification (HTTP 200, autocomplete, match % cards, map markers, polylines).
4. In case of any provider outage or tile delivery failure, toggling `MAP_PROVIDER=leaflet` instantly restores the legacy tile layer without code redeployment.
