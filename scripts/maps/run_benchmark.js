/**
 * CLI script to execute the 100+ Hyderabad Location Accuracy Benchmark Framework.
 */

const fs = require('fs');
const path = require('path');
const BenchmarkRunner = require('../../lib/maps/benchmark');
const hyderabadFixtures = require('../../lib/maps/hyderabad_benchmark_fixtures');

async function main() {
  console.log('==================================================');
  console.log('RUNNING GOTOGETHER HYDERABAD ACCURACY BENCHMARK');
  console.log(`TOTAL TEST CASES: ${hyderabadFixtures.length}`);
  console.log('==================================================');

  const runner = new BenchmarkRunner({ fixtures: hyderabadFixtures });
  const reportData = await runner.runBenchmark();
  const mdReport = runner.generateMarkdownReport(reportData);

  // Print Summary
  console.log('\n--------------------------------------------------');
  console.log(`BENCHMARK COMPLETED IN ${reportData.totalTimeMs}ms`);
  console.log(`SUCCESS RATE: ${reportData.successCount} / ${reportData.totalCount} (${Math.round((reportData.successCount / reportData.totalCount) * 100)}%)`);
  console.log('--------------------------------------------------\n');

  // Breakdown by category
  const categories = {};
  for (const item of reportData.results) {
    if (!categories[item.category]) {
      categories[item.category] = { total: 0, success: 0 };
    }
    categories[item.category].total++;
    if (item.status === 'SUCCESS') categories[item.category].success++;
  }

  console.log('CATEGORY BREAKDOWN:');
  for (const [cat, stats] of Object.entries(categories)) {
    const pct = Math.round((stats.success / stats.total) * 100);
    console.log(` - ${cat.padEnd(22)}: ${stats.success} / ${stats.total} passed (${pct}%)`);
  }

  // Save Markdown Reports
  const docsDir = path.join(__dirname, '../../docs/maps');
  if (!fs.existsSync(docsDir)) {
    fs.mkdirSync(docsDir, { recursive: true });
  }

  const outPath1 = path.join(docsDir, 'hyderabad_accuracy_benchmark.md');
  const outPath2 = path.join(docsDir, 'benchmark_latest.md');

  fs.writeFileSync(outPath1, mdReport, 'utf8');
  fs.writeFileSync(outPath2, mdReport, 'utf8');

  console.log(`\nDetailed report saved to: ${outPath1}`);
}

main().catch(err => {
  console.error('Benchmark execution error:', err);
  process.exit(1);
});
