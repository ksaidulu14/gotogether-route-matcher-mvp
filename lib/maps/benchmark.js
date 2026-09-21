/**
 * GoTogetherRides Mapping & Geocoding Accuracy Benchmark Framework
 */

const geocoderService = require('../geocoding');
const routingService = require('../routing');

const BENCHMARK_FIXTURES = [
  // 1. Locality search
  { category: 'locality_search', query: 'Uppal', reference: 'Uppal, Hyderabad' },
  // 2. Landmark search
  { category: 'landmark_search', query: 'Charminar', reference: 'Charminar, Hyderabad' },
  // 3. Road search
  { category: 'road_search', query: 'Inner Ring Road Hyderabad', reference: 'Inner Ring Road' },
  // 4. PIN-code search
  { category: 'pincode_search', query: '500039', reference: '500039' },
  // 5. Metro/station search
  { category: 'station_search', query: 'Secunderabad Railway Station', reference: 'Secunderabad Junction' },
  // 6. Common misspellings
  { category: 'misspelling_search', query: 'Upaal Hydrabad', reference: 'Uppal, Hyderabad' },
  // 7. Partial queries
  { category: 'partial_query', query: 'Bodu', reference: 'Boduppal' },
  // 8. Reverse geocoding
  { category: 'reverse_geocoding', lat: 17.3984, lon: 78.5583, reference: 'Uppal' },
  // 9. Route distance
  { category: 'route_distance', origin: { lat: 17.3984, lon: 78.5583 }, destination: { lat: 17.4528, lon: 78.6835 }, reference: 'Uppal -> Ghatkesar (~15km)' },
  // 10. Route geometry
  { category: 'route_geometry', origin: { lat: 17.4025, lon: 78.5612 }, destination: { lat: 17.4450, lon: 78.6800 }, reference: 'Geometry sanity' },
  // 11. Route continuity
  { category: 'route_continuity', origin: { lat: 17.4000, lon: 78.5500 }, destination: { lat: 17.4500, lon: 78.6000 }, reference: 'Polyline continuity' },
  // 12. Travel duration
  { category: 'travel_duration', origin: { lat: 17.3984, lon: 78.5583 }, destination: { lat: 17.4528, lon: 78.6835 }, reference: 'Driving duration' }
];

class BenchmarkRunner {
  constructor(options = {}) {
    this.fixtures = options.fixtures || BENCHMARK_FIXTURES;
  }

  async runBenchmark() {
    const results = [];
    const startTime = Date.now();

    for (const item of this.fixtures) {
      const itemStart = Date.now();
      let resItem = {
        category: item.category,
        query: item.query || `${item.lat},${item.lon}` || `${item.origin.lat}->${item.destination.lat}`,
        reference: item.reference,
        provider: 'default',
        status: 'UNKNOWN',
        responseTimeMs: 0,
        returnedResult: null,
        coordinates: null,
        error: null
      };

      try {
        if (item.category.includes('search') || item.category === 'misspelling_search' || item.category === 'partial_query') {
          const searchRes = await geocoderService.search(item.query, { limit: 1 });
          const elapsed = Date.now() - itemStart;
          resItem.responseTimeMs = elapsed;

          if (searchRes && searchRes.length > 0) {
            const top = searchRes[0];
            resItem.provider = top.provider;
            resItem.returnedResult = top.name;
            resItem.coordinates = { lat: top.latitude, lon: top.longitude };
            resItem.status = 'SUCCESS';
          } else {
            resItem.status = 'NO_RESULTS';
          }
        } else if (item.category === 'reverse_geocoding') {
          const revRes = await geocoderService.reverseGeocode(item.lat, item.lon);
          const elapsed = Date.now() - itemStart;
          resItem.responseTimeMs = elapsed;

          if (revRes) {
            resItem.provider = revRes.provider;
            resItem.returnedResult = revRes.name;
            resItem.coordinates = { lat: revRes.latitude, lon: revRes.longitude };
            resItem.status = 'SUCCESS';
          } else {
            resItem.status = 'NO_RESULTS';
          }
        } else if (item.category.startsWith('route_') || item.category === 'travel_duration') {
          const routeRes = await routingService.route(item.origin, item.destination);
          const elapsed = Date.now() - itemStart;
          resItem.responseTimeMs = elapsed;

          if (routeRes && routeRes.geometry && routeRes.geometry.length > 0) {
            resItem.provider = routeRes.provider;
            resItem.returnedResult = `Dist: ${(routeRes.distanceMeters/1000).toFixed(2)}km, Dur: ${Math.round(routeRes.durationSeconds/60)}m, Pts: ${routeRes.geometry.length}`;
            resItem.coordinates = { start: routeRes.geometry[0], end: routeRes.geometry[routeRes.geometry.length - 1] };
            resItem.status = 'SUCCESS';
          } else {
            resItem.status = 'FAILED';
          }
        }
      } catch (err) {
        resItem.responseTimeMs = Date.now() - itemStart;
        resItem.status = 'ERROR';
        resItem.error = err.message;
      }

      results.push(resItem);
    }

    const totalTimeMs = Date.now() - startTime;
    return {
      totalTimeMs,
      totalCount: results.length,
      successCount: results.filter(r => r.status === 'SUCCESS').length,
      results
    };
  }

  generateMarkdownReport(reportData) {
    let md = `# Mapping Infrastructure Accuracy Benchmark Report\n\n`;
    md += `**Total Time**: ${reportData.totalTimeMs}ms  \n`;
    md += `**Success Rate**: ${reportData.successCount} / ${reportData.totalCount} (${Math.round((reportData.successCount / reportData.totalCount) * 100)}%)\n\n`;

    md += `| Category | Query / Input | Reference | Returned Result | Provider | Latency | Status |\n`;
    md += `|---|---|---|---|---|---|---|\n`;

    for (const r of reportData.results) {
      const returnedStr = (r.returnedResult || r.error || 'N/A').replace(/\|/g, '-');
      md += `| \`${r.category}\` | ${r.query} | ${r.reference} | ${returnedStr} | ${r.provider} | ${r.responseTimeMs}ms | **${r.status}** |\n`;
    }

    return md;
  }
}

module.exports = BenchmarkRunner;
