-- GoTogether Carpool Product - Migration 02: Date/Time Scheduling & Double-Journey Join Requests

-- 1. Add Schedule Columns to `journeys` Table
ALTER TABLE journeys
ADD COLUMN IF NOT EXISTS departure_date date DEFAULT CURRENT_DATE,
ADD COLUMN IF NOT EXISTS departure_time time DEFAULT '08:30:00',
ADD COLUMN IF NOT EXISTS time_window_minutes integer DEFAULT 45;

-- 2. Create Performance Indexes for Schedule Filtering
CREATE INDEX IF NOT EXISTS idx_journeys_schedule 
ON journeys (status, departure_date, departure_time);

-- 3. Create `join_requests` Table (Tied to both Requester Journey & Target Journey)
CREATE TABLE IF NOT EXISTS join_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_journey_id uuid REFERENCES journeys(id) ON DELETE CASCADE,
  target_journey_id uuid NOT NULL REFERENCES journeys(id) ON DELETE CASCADE,
  requester_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  requester_name text NOT NULL,
  pickup_name text NOT NULL,
  drop_name text NOT NULL,
  meeting_point_lat float8,
  meeting_point_lon float8,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);

-- 4. Create Indexes on `join_requests`
CREATE INDEX IF NOT EXISTS idx_join_requests_target ON join_requests(target_journey_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_requester_journey ON join_requests(requester_journey_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status ON join_requests(status);

-- 5. Updated Supabase RPC Function with Date & Time Proximity
CREATE OR REPLACE FUNCTION get_nearby_candidate_journeys(
  user_lat float8,
  user_lon float8,
  search_radius_meters float8 DEFAULT 5000,
  user_bearing float8 DEFAULT NULL,
  max_bearing_difference float8 DEFAULT 60,
  target_date date DEFAULT NULL
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
  departure_date date,
  departure_time time,
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
    j.departure_date,
    j.departure_time,
    j.created_at,
    j.route_geojson,
    j.route_distance_meters,
    j.bearing_degrees,
    p.name AS profile_name
  FROM journeys j
  LEFT JOIN profiles p ON p.id = j.user_id
  WHERE j.status = 'active'
    AND (target_date IS NULL OR j.departure_date IS NULL OR j.departure_date = target_date)
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
