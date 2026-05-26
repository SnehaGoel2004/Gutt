'use strict';

const path = require('path');
const { readFile } = require('./fileUtils');

// Built-in patterns that are ALWAYS ignored regardless of .guttignore.
// These are universally noise — no project should commit them.
// Extending this list here means EVERY Gutt repo benefits automatically
// without requiring users to know about .guttignore.
const ALWAYS_IGNORE = [
  '.gutt',           // Gutt internals
  '.guttignore',     // Ignore file itself
  'node_modules',    // npm dependencies — never commit
  '.DS_Store',       // macOS metadata
  'Thumbs.db',       // Windows thumbnail cache
  'package-lock.json', // lock file — too noisy for most projects
  'yarn.lock',       // same
  'dist',            // build output
  'build',           // build output
  'coverage',        // test coverage reports
  '.nyc_output',     // nyc coverage
  '*.map',           // source maps
];

// Patterns that trigger a safety warning but are NOT hard-blocked.
// User is warned but can still proceed.
const SENSITIVE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.production',
  '*.pem',
  '*.key',
  '*.p12',
  'id_rsa',
  'id_dsa',
];

/**
 * Loads and parses a .guttignore file from the repo root.
 * Returns an array of pattern strings.
 * Blank lines and # comments are stripped.
 */
async function loadIgnorePatterns(repoRoot) {
  const ignorePath = path.join(repoRoot, '.guttignore');
  const content = await readFile(ignorePath);
  if (!content) return [];

  return content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'));
}

/**
 * Tests a single file path against a single ignore pattern.
 * Supports:
 *   - Exact match:        "secret.txt"
 *   - Directory prefix:   "node_modules" matches "node_modules/lodash/index.js"
 *   - Wildcard extension: "*.log" matches "server.log"
 *   - Path wildcards:     "build/*" matches "build/output.js"
 */
// function matchesPattern(filePath, pattern) {
//   const normalized = filePath.replace(/\\/g, '/');

//   // Wildcard: *.ext
//   if (pattern.startsWith('*.')) {
//     const ext = pattern.slice(1); // ".ext"
//     return normalized.endsWith(ext) || path.basename(normalized).endsWith(ext);
//   }

//   // Directory or prefix match
//   if (normalized === pattern) return true;
//   if (normalized.startsWith(pattern + '/')) return true;
//   if (path.basename(normalized) === pattern) return true;

//   return false;
// }

function matchesPattern(filePath, pattern) {
  const normalized = filePath.replace(/\\/g, '/');
  const normalizedPattern = pattern.replace(/\\/g, '/');

  // Wildcard extension (*.log)
  if (normalizedPattern.startsWith('*.')) {
    const ext = normalizedPattern.slice(1);
    return normalized.endsWith(ext);
  }

  // Directory pattern (src/ or docs/)
  if (normalizedPattern.endsWith('/')) {
    const dir = normalizedPattern.slice(0, -1);

    return (
      normalized === dir ||
      normalized.startsWith(dir + '/')
    );
  }

  // Exact path match
  if (normalized === normalizedPattern) {
    return true;
  }

  // Nested path match
  if (normalized.startsWith(normalizedPattern + '/')) {
    return true;
  }

  return false;
}

/**
 * Returns true if the file should be completely ignored.
 * Checks built-in patterns first, then .guttignore patterns.
 */
function isIgnored(filePath, userPatterns = []) {
  const allPatterns = [...ALWAYS_IGNORE, ...userPatterns];
  return allPatterns.some(p => matchesPattern(filePath, p));
}

/**
 * Returns true if the file matches a sensitive pattern.
 * Used to emit safety warnings without hard-blocking.
 */
function isSensitive(filePath) {
  return SENSITIVE_PATTERNS.some(p => matchesPattern(filePath, p));
}

module.exports = { loadIgnorePatterns, isIgnored, isSensitive, ALWAYS_IGNORE, SENSITIVE_PATTERNS };
