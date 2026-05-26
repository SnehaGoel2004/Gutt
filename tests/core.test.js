'use strict';

/**
 * tests/core.test.js
 *
 * Tests for the core logic layer — no filesystem, no CLI.
 * Uses Node.js built-in test runner (node --test), available since Node 18.
 *
 * Run: node --test tests/core.test.js
 */

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

const { hashContent, shortHash }       = require('../src/utils/hashUtils');
const { computeDiff, summarizeDiff, diffSummary } = require('../src/utils/diffUtils');
const { isIgnored, isSensitive, matchesPattern }  = require('../src/utils/ignoreUtils');
const CommitSuggestionEngine           = require('../src/analytics/CommitSuggestionEngine');
const HotspotAnalyzer                  = require('../src/analytics/HotspotAnalyzer');
const InsightsEngine                   = require('../src/analytics/InsightsEngine');

// ── hashUtils ────────────────────────────────────────────────────────────────

describe('hashUtils', () => {
  test('hashContent produces consistent SHA-1 hex strings', () => {
    const h = hashContent('hello world');
    assert.equal(typeof h, 'string');
    assert.equal(h.length, 40);
    // Same content → same hash (deterministic)
    assert.equal(hashContent('hello world'), h);
  });

  test('different content produces different hashes', () => {
    assert.notEqual(hashContent('a'), hashContent('b'));
  });

  test('shortHash returns 8 characters', () => {
    const full  = hashContent('test');
    const short = shortHash(full);
    assert.equal(short.length, 8);
    assert.equal(short, full.substring(0, 8));
  });

  test('shortHash handles null gracefully', () => {
    assert.equal(shortHash(null), '(none)');
  });
});

// ── diffUtils ────────────────────────────────────────────────────────────────

describe('diffUtils', () => {
  test('summarizeDiff counts added and removed lines', () => {
    const diff = computeDiff('line1\nline2\n', 'line1\nline3\n');
    const { added, removed } = summarizeDiff(diff);
    assert.equal(added,   1);
    assert.equal(removed, 1);
  });

  test('diffSummary on identical strings returns 0/0', () => {
    const { added, removed } = diffSummary('same', 'same');
    assert.equal(added,   0);
    assert.equal(removed, 0);
  });

  test('diffSummary handles empty old content (new file)', () => {
    const { added } = diffSummary('', 'hello\nworld\n');
    assert.ok(added > 0);
  });
});

// ── ignoreUtils ──────────────────────────────────────────────────────────────

describe('ignoreUtils', () => {
  test('node_modules is always ignored', () => {
    assert.equal(isIgnored('node_modules/lodash/index.js'), true);
  });

  test('.gutt directory is always ignored', () => {
    assert.equal(isIgnored('.gutt/HEAD'), true);
  });

  test('regular source files are not ignored', () => {
    assert.equal(isIgnored('src/auth.js'), false);
  });

  test('user pattern: *.log matches log files', () => {
    assert.equal(isIgnored('server.log', ['*.log']), true);
  });

  test('user pattern: build/ directory prefix matches build output', () => {
    assert.equal(isIgnored('build/output.js', ['build']), true);
  });

  test('.env is sensitive but not hard-ignored', () => {
    assert.equal(isIgnored('.env'), false);
    assert.equal(isSensitive('.env'), true);
  });

  test('.pem files are sensitive', () => {
    assert.equal(isSensitive('server.pem'), true);
  });

  test('normal files are not sensitive', () => {
    assert.equal(isSensitive('src/index.js'), false);
  });
});

// ── CommitSuggestionEngine ───────────────────────────────────────────────────

describe('CommitSuggestionEngine', () => {
  const engine = new CommitSuggestionEngine();

  test('auth.js triggers authentication suggestion', () => {
    const result = engine.suggest([{ path: 'src/auth.js', hash: 'abc' }], []);
    assert.match(result.message, /auth/i);
    assert.equal(result.intent, 'Authentication');
    assert.ok(result.confidence >= 70);
  });

  test('test files trigger test suggestion', () => {
    const result = engine.suggest([{ path: 'components.test.js', hash: 'abc' }], []);
    assert.match(result.message, /test/i);
    assert.equal(result.intent, 'Testing');
  });

  test('heavy removal triggers cleanup suggestion', () => {
    const result = engine.suggest(
      [{ path: 'legacy.js', hash: 'abc' }],
      [{ path: 'legacy.js', added: 2, removed: 50 }]
    );
    assert.match(result.message, /remov|clean/i);
  });

  test('single file fallback uses filename', () => {
    const result = engine.suggest([{ path: 'widgets.js', hash: 'abc' }], []);
    assert.ok(result.message.length > 0);
  });

  test('always returns a non-empty message string', () => {
    const result = engine.suggest([{ path: 'xyz.js', hash: 'abc' }], []);
    assert.ok(typeof result.message === 'string' && result.message.length > 0);
    assert.ok(typeof result.confidence === 'number');
    assert.ok(result.confidence >= 0 && result.confidence <= 100);
  });
});

// ── HotspotAnalyzer ──────────────────────────────────────────────────────────

describe('HotspotAnalyzer', () => {
  const analyzer = new HotspotAnalyzer();

  const makeHistory = (entries) => entries.map(([file, daysAgo]) => ({
    hash:      hashContent(file + daysAgo),
    message:   'test commit',
    timeStamp: new Date(Date.now() - daysAgo * 86400000).toISOString(),
    files:     [{ path: file, hash: 'x' }],
  }));

  test('returns empty array for empty history', () => {
    assert.deepEqual(analyzer.analyze([]), []);
  });

  test('most frequently changed file ranks first', () => {
    const history = [
      ...makeHistory([['auth.js', 1], ['auth.js', 2], ['auth.js', 3]]),
      ...makeHistory([['server.js', 1]]),
    ];
    const spots = analyzer.analyze(history);
    assert.equal(spots[0].path, 'auth.js');
  });

  test('heat is between 1 and 5', () => {
    const history = makeHistory([['file.js', 1], ['other.js', 2]]);
    const spots   = analyzer.analyze(history);
    for (const s of spots) {
      assert.ok(s.heat >= 1 && s.heat <= 5);
    }
  });

  test('recent files score higher than old files with same count', () => {
    const history = [
      ...makeHistory([['recent.js', 1]]),
      ...makeHistory([['old.js', 60]]),
    ];
    const spots = analyzer.analyze(history);
    const recentSpot = spots.find(s => s.path === 'recent.js');
    const oldSpot    = spots.find(s => s.path === 'old.js');
    assert.ok(recentSpot.churnScore > oldSpot.churnScore);
  });
});

// ── InsightsEngine ───────────────────────────────────────────────────────────

describe('InsightsEngine', () => {
  const engine = new InsightsEngine();

  test('returns empty for no history', () => {
    assert.equal(engine.compute([]).empty, true);
  });

  test('computes correct total commits', () => {
    const history = [
      { hash: 'a', message: 'm', timeStamp: new Date().toISOString(), files: [{ path: 'f.js', hash: 'x' }], branch: 'main' },
      { hash: 'b', message: 'm', timeStamp: new Date().toISOString(), files: [{ path: 'f.js', hash: 'x' }], branch: 'main' },
    ];
    const result = engine.compute(history);
    assert.equal(result.totalCommits, 2);
  });

  test('identifies top file correctly', () => {
    const history = [
      { hash: 'a', message: 'm', timeStamp: new Date().toISOString(), files: [{ path: 'auth.js', hash: 'x' }, { path: 'app.js', hash: 'y' }], branch: 'main' },
      { hash: 'b', message: 'm', timeStamp: new Date().toISOString(), files: [{ path: 'auth.js', hash: 'x' }], branch: 'main' },
    ];
    const result = engine.compute(history);
    assert.equal(result.topFiles[0][0], 'auth.js');
  });
});
