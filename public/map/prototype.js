/**
 * GoTogetherRides MapLibre GL JS + PMTiles Prototype Script
 */

document.addEventListener('DOMContentLoaded', () => {
  // Register PMTiles Protocol with MapLibre GL
  const protocol = new pmtiles.Protocol();
  maplibregl.addProtocol("pmtiles", protocol.tile);

  // Default coordinates centered on Hyderabad / Telangana test region
  const defaultCenter = [78.5800, 17.4200];
  const defaultZoom = 11.5;

  // Initialize MapLibre GL Map
  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: {
        'osm-tiles': {
          type: 'raster',
          tiles: [
            'https://tile.openstreetmap.org/{z}/{x}/{y}.png'
          ],
          tileSize: 256,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }
      },
      layers: [
        {
          id: 'osm-tiles-layer',
          type: 'raster',
          source: 'osm-tiles',
          minzoom: 0,
          maxzoom: 19
        }
      ]
    },
    center: defaultCenter,
    zoom: defaultZoom
  });

  map.addControl(new maplibregl.NavigationControl(), 'top-right');

  // Sample Test Route Data
  const sampleData = {
    userPickup: [17.3984, 78.5583], // Uppal [lat, lon]
    userDrop: [17.4528, 78.6835],   // Ghatkesar
    candPickup: [17.3750, 78.5600], // Nagole
    candDrop: [17.4528, 78.6835],   // Ghatkesar
    meetingPoint: [17.4025, 78.5612], // Dynamic Meeting near Uppal Ring Road

    // Geometry polylines: Array of [lon, lat] for MapLibre GeoJSON compatibility
    userRouteLonLat: [
      [78.5583, 17.3984],
      [78.5612, 17.4025],
      [78.5850, 17.4150],
      [78.6120, 17.4300],
      [78.6500, 17.4450],
      [78.6835, 17.4528]
    ],
    candRouteLonLat: [
      [78.5600, 17.3750],
      [78.5612, 17.4025],
      [78.5850, 17.4150],
      [78.6120, 17.4300],
      [78.6500, 17.4450],
      [78.6835, 17.4528]
    ],
    sharedRouteLonLat: [
      [78.5612, 17.4025],
      [78.5850, 17.4150],
      [78.6120, 17.4300],
      [78.6500, 17.4450],
      [78.6835, 17.4528]
    ]
  };

  map.on('load', () => {
    // 1. Add User Route GeoJSON Source & Layer (Blue)
    map.addSource('user-route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: sampleData.userRouteLonLat
        }
      }
    });

    map.addLayer({
      id: 'user-route-layer',
      type: 'line',
      source: 'user-route-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#3b82f6', 'line-width': 5, 'line-opacity': 0.8 }
    });

    // 2. Add Candidate Route GeoJSON Source & Layer (Orange)
    map.addSource('cand-route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: sampleData.candRouteLonLat
        }
      }
    });

    map.addLayer({
      id: 'cand-route-layer',
      type: 'line',
      source: 'cand-route-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.85 }
    });

    // 3. Add Shared Route GeoJSON Source & Layer (Green Overlap)
    map.addSource('shared-route-src', {
      type: 'geojson',
      data: {
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: sampleData.sharedRouteLonLat
        }
      }
    });

    map.addLayer({
      id: 'shared-route-layer',
      type: 'line',
      source: 'shared-route-src',
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#22c55e', 'line-width': 6, 'line-opacity': 0.95 }
    });

    // Add Markers
    createMarker([sampleData.userPickup[1], sampleData.userPickup[0]], 'pin-user-pickup', '●');
    createMarker([sampleData.userDrop[1], sampleData.userDrop[0]], 'pin-user-drop', '🚩');
    createMarker([sampleData.candPickup[1], sampleData.candPickup[0]], 'pin-cand-pickup', 'P');
    createMarker([sampleData.candDrop[1], sampleData.candDrop[0]], 'pin-cand-drop', '🚩');
    createMarker([sampleData.meetingPoint[1], sampleData.meetingPoint[0]], 'pin-meeting', '📍');
  });

  function createMarker(lngLat, className, textContent) {
    const el = document.createElement('div');
    el.className = `maplibre-marker ${className}`;
    el.innerHTML = textContent;

    new maplibregl.Marker({ element: el })
      .setLngLat(lngLat)
      .addTo(map);
  }

  document.getElementById('btn-recenter').addEventListener('click', () => {
    map.flyTo({ center: defaultCenter, zoom: defaultZoom, speed: 1.2 });
  });
});
