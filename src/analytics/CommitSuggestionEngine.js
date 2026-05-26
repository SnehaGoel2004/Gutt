'use strict';

const path = require('path');

/**
 * CommitSuggestionEngine — commit intent detection with confidence scoring.
 *
 * Analyzes staged files and diff statistics to:
 *   1. Detect developer intent (what kind of change is this?)
 *   2. Generate a specific, accurate commit message
 *   3. Assign a confidence score (0–100) based on signal strength
 *
 * Intelligence model (no external AI required):
 *   - FILENAME SIGNAL     — filenames carry semantic meaning (auth.js → authentication)
 *   - MULTI-FILE SIGNAL   — multiple related files amplify confidence (auth + login = 95%)
 *   - EXTENSION SIGNAL    — .test.js, .css, .json have clear semantics
 *   - CHANGE VOLUME       — deletion-heavy → cleanup; addition-heavy → feature
 *   - PATH SIGNAL         — directory names (middleware/, models/, tests/) add context
 *
 * This is the same heuristic approach used by conventional-commits linters
 * and semantic-release tools in production CI pipelines.
 */
class CommitSuggestionEngine {
  constructor() {
    /**
     * Intent rules: each rule defines:
     *   patterns   — regex list, tested against full lowercased file paths
     *   intent     — human-readable intent label
     *   messages   — candidate commit messages (one is picked randomly for variety)
     *   confidence — base confidence when a single file matches (0–100)
     *
     * Rules are ordered by specificity — more specific rules appear first.
     */
    this.intentRules = [
      {
        patterns:   [/auth/, /login/, /logout/, /session/, /jwt/, /token/, /oauth/],
        intent:     'Authentication',
        messages:   [
          'Refactored authentication flow',
          'Updated auth middleware and validation',
          'Improved login/logout handling',
          'Secured authentication logic',
        ],
        confidence: 80,
      },
      {
        patterns:   [/password/, /passwd/, /hash.*pass/, /bcrypt/, /crypto/],
        intent:     'Security',
        messages:   [
          'Updated password hashing and security layer',
          'Hardened credential handling',
          'Improved security validation',
        ],
        confidence: 85,
      },
      {
        patterns:   [/test/, /spec/, /\.test\./, /\.spec\./, /__tests__/],
        intent:     'Testing',
        messages:   [
          'Added/updated test coverage',
          'Improved test suite',
          'Fixed failing tests',
        ],
        confidence: 90,
      },
      {
        patterns:   [/api/, /endpoint/, /controller/, /handler/, /route/, /router/],
        intent:     'API Layer',
        messages:   [
          'Extended API endpoints',
          'Updated route handlers',
          'Refactored controller logic',
          'Modified API layer',
        ],
        confidence: 78,
      },
      {
        patterns:   [/db/, /database/, /schema/, /migration/, /model/, /entity/, /repository/],
        intent:     'Data Layer',
        messages:   [
          'Updated database schema or queries',
          'Refactored data layer',
          'Modified database models',
          'Updated repository logic',
        ],
        confidence: 82,
      },
      {
        patterns:   [/middleware/],
        intent:     'Middleware',
        messages:   [
          'Updated middleware pipeline',
          'Refactored middleware layer',
        ],
        confidence: 88,
      },
      {
        patterns:   [/config/, /setting/, /env/, /\.env/, /dotenv/],
        intent:     'Configuration',
        messages:   [
          'Updated configuration',
          'Modified environment settings',
          'Adjusted config values',
        ],
        confidence: 85,
      },
      {
        patterns:   [/style/, /css/, /scss/, /less/, /sass/, /theme/, /ui/, /design/],
        intent:     'Styling',
        messages:   [
          'Updated styles and UI design',
          'Styling improvements',
          'Refactored CSS layer',
        ],
        confidence: 88,
      },
      {
        patterns:   [/util/, /helper/, /common/, /shared/, /lib\//],
        intent:     'Utilities',
        messages:   [
          'Updated shared utility functions',
          'Refactored helper module',
          'Improved common utilities',
        ],
        confidence: 72,
      },
      {
        patterns:   [/readme/, /docs?\//, /documentation/, /changelog/, /\.md$/],
        intent:     'Documentation',
        messages:   [
          'Updated documentation',
          'Improved README',
          'Added inline documentation',
        ],
        confidence: 92,
      },
      {
        patterns:   [/package\.json/, /yarn\.lock/, /package-lock/, /npm/, /dependency/],
        intent:     'Dependencies',
        messages:   [
          'Updated dependencies',
          'Modified package configuration',
          'Bumped package versions',
        ],
        confidence: 90,
      },
      {
        patterns:   [/server/, /app\.js/, /main\.js/, /index\.js/],
        intent:     'Entry Point',
        messages:   [
          'Updated server/application entry point',
          'Modified startup logic',
          'Adjusted main application configuration',
        ],
        confidence: 65,
      },
      {
        patterns:   [/error/, /exception/, /catch/, /fault/, /fallback/],
        intent:     'Error Handling',
        messages:   [
          'Improved error handling',
          'Added error recovery logic',
          'Fixed exception handling paths',
        ],
        confidence: 78,
      },
      {
        patterns:   [/cache/, /redis/, /memcache/],
        intent:     'Caching',
        messages:   [
          'Updated caching layer',
          'Improved cache invalidation logic',
        ],
        confidence: 85,
      },
    ];
  }

  /**
   * Analyzes staged files and diff stats to produce a structured suggestion.
   *
   * @param {Array} stagedFiles  - [{ path, hash }]
   * @param {Array} diffStats    - [{ path, added, removed }]
   * @returns {{ message: string, intent: string, confidence: number }}
   */
  suggest(stagedFiles, diffStats = []) {
    const totalAdded   = diffStats.reduce((s, d) => s + d.added,   0);
    const totalRemoved = diffStats.reduce((s, d) => s + d.removed, 0);
    const fileCount    = stagedFiles.length;

    // ── Step 1: Find matching intent rule ────────────────────────────────
    const matchResult = this._findBestIntent(stagedFiles);

    if (matchResult) {
      const { rule, matchCount } = matchResult;

      // Confidence boost: multiple files match the same intent
      // Each additional matching file adds 5% confidence, capped at 98%
      const multiFileBoost = Math.min((matchCount - 1) * 5, 15);
      const confidence      = Math.min(rule.confidence + multiFileBoost, 98);

      return {
        message:    this._pick(rule.messages),
        intent:     rule.intent,
        confidence: confidence,
      };
    }

    // ── Step 2: Change-volume heuristics (no filename signal) ────────────
    if (totalRemoved > totalAdded * 2 && totalRemoved > 10) {
      return {
        message:    'Removed dead code and cleaned up files',
        intent:     'Code Cleanup',
        confidence: 70,
      };
    }

    if (totalAdded > 100 && fileCount > 3) {
      return {
        message:    'Major feature addition across multiple files',
        intent:     'Feature Addition',
        confidence: 60,
      };
    }

    // ── Step 3: Extension-based fallbacks ────────────────────────────────
    const exts = stagedFiles.map(f => path.extname(f.path).toLowerCase());

    if (exts.length > 0 && exts.every(e => ['.css', '.scss', '.less', '.sass'].includes(e))) {
      return { message: 'Styling updates', intent: 'Styling', confidence: 88 };
    }

    // ── Step 4: Generic fallbacks (lowest confidence) ────────────────────
    if (fileCount === 1) {
      return {
        message:    `Updated ${this._shortPath(stagedFiles[0].path)}`,
        intent:     'General Update',
        confidence: 40,
      };
    }
    if (fileCount <= 3) {
      return {
        message:    `Updated ${stagedFiles.map(f => this._shortPath(f.path)).join(', ')}`,
        intent:     'General Update',
        confidence: 35,
      };
    }

    return {
      message:    `Updated ${fileCount} files`,
      intent:     'General Update',
      confidence: 25,
    };
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  /**
   * Finds the intent rule with the most pattern matches across all staged files.
   * Returns { rule, matchCount } or null if no rule matches.
   */
  _findBestIntent(stagedFiles) {
    let bestRule       = null;
    let bestMatchCount = 0;

    for (const rule of this.intentRules) {
      let matchCount = 0;

      for (const file of stagedFiles) {
        const filePath = file.path.toLowerCase();
        const matches  = rule.patterns.some(p =>
          p instanceof RegExp ? p.test(filePath) : filePath.includes(p)
        );
        if (matches) matchCount++;
      }

      if (matchCount > bestMatchCount) {
        bestMatchCount = matchCount;
        bestRule       = rule;
      }
    }

    return bestRule ? { rule: bestRule, matchCount: bestMatchCount } : null;
  }

  _pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  _shortPath(filePath) {
    return filePath ? path.basename(filePath) : 'files';
  }
}

module.exports = CommitSuggestionEngine;
