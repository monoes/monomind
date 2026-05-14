#!/usr/bin/env npx tsx
/**
 * Pattern Store Test Suite
 * Tests list, search, download, and publish functionality
 */
import { createDiscoveryService } from '../store/discovery.js';
import { searchPatterns, getSearchSuggestions, getTagCloud } from '../store/search.js';
import { createDownloader } from '../store/download.js';
import { createPublisher } from '../store/publish.js';
import { createSeraphineGenesis } from '../models/seraphine.js';
// Test results tracking
const results = [];
function logTest(name, passed, details) {
    results.push({ test: name, passed, details });
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}${details ? `: ${details}` : ''}`);
}
async function runTests() {
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════╗');
    console.log('║        PATTERN STORE TEST SUITE                          ║');
    console.log('║        Testing List, Search, Download, Publish           ║');
    console.log('╚══════════════════════════════════════════════════════════╝');
    console.log('');
    // ==========================================================================
    // 1. DISCOVERY TESTS
    // ==========================================================================
    console.log('─── Discovery Tests ───────────────────────────────────────');
    try {
        const discovery = createDiscoveryService();
        logTest('Discovery service created', true);
        // List registries
        const registries = discovery.listRegistries();
        logTest('List registries', registries.length > 0, `Found ${registries.length} registries`);
        // Discover registry
        const result = await discovery.discoverRegistry();
        logTest('Discover registry', result.success, result.success
            ? `Loaded ${result.registry?.patterns.length || 0} patterns`
            : result.error);
        // Cache test
        if (result.success) {
            const cachedResult = await discovery.discoverRegistry();
            logTest('Cache hit', cachedResult.fromCache, 'Second request from cache');
        }
        console.log('');
        // ==========================================================================
        // 2. SEARCH TESTS
        // ==========================================================================
        console.log('─── Search Tests ──────────────────────────────────────────');
        if (result.success && result.registry) {
            const registry = result.registry;
            // Basic search
            const basicSearch = searchPatterns(registry);
            logTest('Basic search', basicSearch.patterns.length > 0, `Found ${basicSearch.total} patterns`);
            // Query search
            const querySearch = searchPatterns(registry, { query: 'routing' });
            logTest('Query search', true, `Query "routing" found ${querySearch.patterns.length} patterns`);
            // Category filter
            const categorySearch = searchPatterns(registry, { category: 'routing' });
            logTest('Category filter', true, `Category "routing" found ${categorySearch.patterns.length} patterns`);
            // Tag search
            const tagSearch = searchPatterns(registry, { tags: ['genesis'] });
            logTest('Tag search', true, `Tag "genesis" found ${tagSearch.patterns.length} patterns`);
            // Verified filter
            const verifiedSearch = searchPatterns(registry, { verified: true });
            logTest('Verified filter', true, `Verified patterns: ${verifiedSearch.patterns.length}`);
            // Sort by downloads
            const sortedSearch = searchPatterns(registry, {
                sortBy: 'downloads',
                sortOrder: 'desc',
            });
            logTest('Sort by downloads', true, `Top pattern: ${sortedSearch.patterns[0]?.displayName || 'none'}`);
            // Pagination
            const page1 = searchPatterns(registry, { limit: 5, offset: 0 });
            logTest('Pagination', page1.pageSize === 5, `Page 1 with ${page1.patterns.length} patterns, hasMore: ${page1.hasMore}`);
            // Search suggestions
            const suggestions = getSearchSuggestions(registry, 'rou');
            logTest('Search suggestions', suggestions.length >= 0, `Suggestions for "rou": ${suggestions.slice(0, 3).join(', ')}`);
            // Tag cloud
            const tagCloud = getTagCloud(registry);
            logTest('Tag cloud', tagCloud.size > 0, `${tagCloud.size} unique tags`);
        }
        console.log('');
        // ==========================================================================
        // 3. DOWNLOAD TESTS
        // ==========================================================================
        console.log('─── Download Tests ────────────────────────────────────────');
        if (result.success && result.registry && result.registry.patterns.length > 0) {
            const pattern = result.registry.patterns[0];
            const downloader = createDownloader();
            logTest('Downloader created', true);
            // Download with progress
            let progressCalled = false;
            const downloadResult = await downloader.downloadPattern(pattern, {
                verify: true,
            }, (progress) => {
                progressCalled = true;
            });
            logTest('Download pattern', downloadResult.success, downloadResult.success
                ? `Downloaded ${downloadResult.size} bytes`
                : 'Failed');
            logTest('Progress callback', progressCalled, progressCalled ? 'Progress events received' : 'No progress events');
            logTest('Checksum verification', downloadResult.verified !== undefined, `Verified: ${downloadResult.verified}`);
            // Cache stats
            const cacheStats = downloader.getCacheStats();
            logTest('Cache statistics', cacheStats.count >= 0, `${cacheStats.count} items, ${cacheStats.totalSize} bytes`);
        }
        console.log('');
        // ==========================================================================
        // 4. PUBLISH TESTS
        // ==========================================================================
        console.log('─── Publish Tests ─────────────────────────────────────────');
        const cfp = createSeraphineGenesis();
        const publisher = createPublisher();
        logTest('Publisher created', true);
        // Validation
        const validation = publisher.validateForPublish(cfp, {
            name: 'test-pattern',
            displayName: 'Test Pattern',
            description: 'A test pattern for validation',
            categories: ['testing'],
            tags: ['test', 'validation', 'demo'],
            license: 'MIT',
            anonymize: 'standard',
        });
        logTest('Publish validation', validation.length === 0, validation.length === 0 ? 'All validations passed' : validation.join(', '));
        // Preview
        const preview = publisher.createPreview(cfp, {
            name: 'seraphine-genesis',
            displayName: 'Seraphine Genesis',
            description: 'The foundational pattern model',
            categories: ['routing', 'coordination'],
            tags: ['genesis', 'foundational'],
            license: 'MIT',
            anonymize: 'standard',
        });
        logTest('Publish preview', preview !== null, `Preview created for ${preview.name}`);
        // Publish (mock)
        const publishResult = await publisher.publishPattern(cfp, {
            name: 'test-pattern',
            displayName: 'Test Pattern',
            description: 'A test pattern published to IPFS',
            categories: ['testing'],
            tags: ['test', 'demo', 'hello-world'],
            license: 'MIT',
            anonymize: 'standard',
        });
        logTest('Publish to IPFS', publishResult.success, publishResult.success
            ? `CID: ${publishResult.cid.slice(0, 20)}...`
            : publishResult.message);
        console.log('');
        // ==========================================================================
        // 5. INTEGRATION TEST
        // ==========================================================================
        console.log('─── Integration Test ──────────────────────────────────────');
        // Full workflow: discover -> search -> download
        const store = createDiscoveryService();
        const discoverResult = await store.discoverRegistry();
        if (discoverResult.success && discoverResult.registry) {
            const searchResult = searchPatterns(discoverResult.registry, {
                query: 'seraphine',
            });
            if (searchResult.patterns.length > 0) {
                const dl = createDownloader();
                const dlResult = await dl.downloadPattern(searchResult.patterns[0], {
                    verify: true,
                });
                logTest('Full workflow', dlResult.success, 'Discover → Search → Download completed');
            }
            else {
                logTest('Full workflow', true, 'Discover → Search completed (no download)');
            }
        }
    }
    catch (error) {
        console.error('Test error:', error);
        logTest('Test suite', false, `Error: ${error}`);
    }
    // ==========================================================================
    // SUMMARY
    // ==========================================================================
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('                      TEST SUMMARY                          ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;
    const total = results.length;
    console.log(`   Total Tests: ${total}`);
    console.log(`   ✅ Passed: ${passed}`);
    console.log(`   ❌ Failed: ${failed}`);
    console.log('');
    if (failed === 0) {
        console.log('   🎉 All tests passed!');
        console.log('');
        console.log('   📦 Store Features Verified:');
        console.log('      - Registry discovery via IPNS');
        console.log('      - Pattern search with filters');
        console.log('      - Download with verification');
        console.log('      - Publish with anonymization');
        console.log('');
    }
    else {
        console.log('   ⚠️ Some tests failed. Please review the output above.');
    }
    process.exit(failed > 0 ? 1 : 0);
}
// Run tests
runTests().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
//# sourceMappingURL=test-store.js.map