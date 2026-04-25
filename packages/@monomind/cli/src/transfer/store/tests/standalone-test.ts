#!/usr/bin/env npx tsx
/**
 * Standalone Pattern Store Test
 * Run this in any environment to verify the IPFS-based pattern store works
 *
 * Usage:
 *   npx tsx standalone-test.ts
 *   # or
 *   npm run test:pattern-store
 */

import {
  PatternStore,
  createDiscoveryService,
  searchPatterns,
  getFeaturedPatterns,
  getTrendingPatterns,
  getNewestPatterns,
  getCategoryStats,
  getTagCloud,
  getSearchSuggestions,
  getSimilarPatterns,
} from '../index.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║  MONOBRAIN - STANDALONE PATTERN STORE TEST                   ║');
  console.log('║  IPFS-Based Decentralized Pattern Marketplace                ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('');

  let passed = 0;
  let failed = 0;

  // Test 1: Discovery Service Creation
  console.log('▶ Test 1: Create Discovery Service');
  try {
    const discovery = createDiscoveryService();
    const registries = discovery.listRegistries();
    console.log(`  ✅ Created service with ${registries.length} bootstrap registries`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 2: Discover Registry
  console.log('▶ Test 2: Discover Registry via IPNS');
  let registry: any = null;
  try {
    const discovery = createDiscoveryService();
    const result = await discovery.discoverRegistry();
    if (result.success && result.registry) {
      registry = result.registry;
      console.log(`  ✅ Discovered ${result.registry.patterns.length} patterns from ${result.source}`);
      passed++;
    } else {
      throw new Error(result.error || 'No registry');
    }
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  if (!registry) {
    console.log('\n❌ Cannot continue without registry\n');
    process.exit(1);
  }

  // Test 3: Search Patterns
  console.log('▶ Test 3: Search for "agent"');
  try {
    const results = searchPatterns(registry, { query: 'agent' });
    console.log(`  ✅ Found ${results.patterns.length} patterns matching "agent"`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 4: Get Featured Patterns
  console.log('▶ Test 4: Get Featured Patterns');
  try {
    const featured = getFeaturedPatterns(registry);
    console.log(`  ✅ Found ${featured.length} featured patterns`);
    if (featured.length > 0) {
      console.log(`     - ${featured[0].name} (${featured[0].id})`);
    }
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 5: Get Trending Patterns
  console.log('▶ Test 5: Get Trending Patterns');
  try {
    const trending = getTrendingPatterns(registry);
    console.log(`  ✅ Found ${trending.length} trending patterns`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 6: Get Newest Patterns
  console.log('▶ Test 6: Get Newest Patterns');
  try {
    const newest = getNewestPatterns(registry);
    console.log(`  ✅ Found ${newest.length} newest patterns`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 7: Search with Filters
  console.log('▶ Test 7: Search with Filters (verified only)');
  try {
    const results = searchPatterns(registry, { verified: true });
    console.log(`  ✅ Found ${results.patterns.length} verified patterns`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 8: Category Stats
  console.log('▶ Test 8: Get Category Statistics');
  try {
    const stats = getCategoryStats(registry);
    const count = Array.isArray(stats) ? stats.length : Object.keys(stats).length;
    console.log(`  ✅ Found ${count} categories with stats`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 9: Tag Cloud
  console.log('▶ Test 9: Get Tag Cloud');
  try {
    const tags = getTagCloud(registry);
    console.log(`  ✅ Found ${tags.size} unique tags`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 10: Search Suggestions
  console.log('▶ Test 10: Get Search Suggestions');
  try {
    const suggestions = getSearchSuggestions(registry, 'pat');
    console.log(`  ✅ Got ${suggestions.length} suggestions for "pat"`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Test 11: PatternStore Class
  console.log('▶ Test 11: PatternStore Class API');
  try {
    const store = new PatternStore();
    await store.initialize();
    const stats = store.getStats();
    console.log(`  ✅ PatternStore initialized:`);
    console.log(`     Total Patterns: ${stats.totalPatterns}`);
    console.log(`     Total Downloads: ${stats.totalDownloads.toLocaleString()}`);
    console.log(`     Categories: ${stats.categories}`);
    passed++;
  } catch (e) {
    console.log(`  ❌ Failed: ${(e as Error).message}`);
    failed++;
  }

  // Summary
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                        TEST RESULTS                            ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  Total:  ${passed + failed}`);
  console.log(`  ✅ Passed: ${passed}`);
  console.log(`  ❌ Failed: ${failed}`);
  console.log('');

  if (failed === 0) {
    console.log('  🎉 All tests passed! Pattern Store is working correctly.');
    console.log('');
    console.log('  Available CLI Commands:');
    console.log('    npx @monobrain/cli patterns list');
    console.log('    npx @monobrain/cli patterns list --featured');
    console.log('    npx @monobrain/cli patterns search -q "agent"');
    console.log('    npx @monobrain/cli patterns info -n <pattern-id>');
    console.log('');
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
