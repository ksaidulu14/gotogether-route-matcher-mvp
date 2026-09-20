-- GoTogether Route Matcher MVP - Database Migration for Spatial Indexing & Precomputation

-- 1. Enable PostGIS Extension (if available in Supabase project)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Add Precomputation Columns to `journeys` Table
ALTER TABLE journeys
ADD COLUMN IF NOT EXISTS pickup_geo geography(Point, 4326),
ADD COLUMN IF NOT EXISTS drop_geo geography(Point, 4326),
ADD COLUMN IF NOT EXISTS route_geojson jsonb,
ADD COLUMN IF NOT EXISTS route_distance_meters float8,
ADD COLUMN IF NOT EXISTS bearing_degrees float8;

-- 3. Create GiST Spatial Index on Pickup Geography for Sub-15ms Proximity Searches
CREATE INDEX IF NOT EXISTS idx_journeys_pickup_geo 
ON journeys USING GIST (pickup_geo);

-- 4. Create Performance Indexes for Active Journeys & Creation Order
CREATE INDEX IF NOT EXISTS idx_journeys_status_created 
ON journeys (status, created_at DESC);

-- 5. Create Composite Index for Status & Journey Direction Angles
CREATE INDEX IF NOT EXISTS idx_journeys_status_bearing 
ON journeys (status, bearing_degrees);

-- 6. Trigger to automatically keep `pickup_geo` and `drop_geo` synced with lat/lon
CREATE OR REPLACE FUNCTION sync_journey_geographies()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.pickup_lat IS NOT NULL AND NEW.pickup_lon IS NOT NULL THEN
    NEW.pickup_geo := ST_SetSRID(ST_MakePoint(NEW.pickup_lon, NEW.pickup_lat), 4326)::geography;
  END IF;
  IF NEW.drop_lat IS NOT NULL AND NEW.drop_lon IS NOT NULL THEN
    NEW.drop_geo := ST_SetSRID(ST_MakePoint(NEW.drop_lon, NEW.drop_lat), 4326)::geography;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_journey_geographies ON journeys;
CREATE TRIGGER trg_sync_journey_geographies
BEFORE INSERT OR UPDATE ON journeys
FOR EACH ROW
EXECUTE FUNCTION sync_journey_geographies();

-- 7. Supabase RPC Function for Spatial Candidate Retrieval
CREATE OR REPLACE FUNCTION get_nearby_candidate_journeys(
  user_lat float8,
  user_lon float8,
  search_radius_meters float8 DEFAULT 5000,
  user_bearing float8 DEFAULT NULL,
  max_bearing_difference float8 DEFAULT 60
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  pickup_name text,
  pickup_lat float8,
  pickup_lon float8,
  drop_name text,
  drop_lat float8,
  drop_lon float8,
  status text,
  created_at timestamptz,
  route_geojson jsonb,
  route_distance_meters float8,
  bearing_degrees float8,
  profile_name text
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    j.id,
    j.user_id,
    j.pickup_name,
    j.pickup_lat,
    j.pickup_lon,
    j.drop_name,
    j.drop_lat,
    j.drop_lon,
    j.status,
    j.created_at,
    j.route_geojson,
    j.route_distance_meters,
    j.bearing_degrees,
    p.name AS profile_name
  FROM journeys j
  LEFT JOIN profiles p ON p.id = j.user_id
  WHERE j.status = 'active'
    AND ST_DWithin(
      j.pickup_geo,
      ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography,
      search_radius_meters
    )
    AND (
      user_bearing IS NULL 
      OR j.bearing_degrees IS NULL
      OR (
        ABS(j.bearing_degrees - user_bearing) % 360 <= max_bearing_difference
        OR 360 - (ABS(j.bearing_degrees - user_bearing) % 360) <= max_bearing_difference
      )
    )
  ORDER BY ST_Distance(
    j.pickup_geo,
    ST_SetSRID(ST_MakePoint(user_lon, user_lat), 4326)::geography
  ) ASC
  LIMIT 100;
END;
$$;
