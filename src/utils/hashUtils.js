'use strict';

const crypto = require('crypto');

/**
 * hashBuffer — hashes raw file bytes.
 *
 * WHY BUFFERS, NOT STRINGS:
 * Git and all production VCS tools store files as raw byte sequences.
 * Converting to a string before hashing is lossy for two reasons:
 *   1. Non-UTF-8 files (images, compiled binaries) cannot round-trip
 *      through a string encoding without byte corruption.
 *   2. UTF-8 files with BOMs or unusual sequences may be "normalized"
 *      by JavaScript's string layer, changing their byte content.
 *
 * The hash must be computed on the exact bytes that will be stored and
 * later restored — otherwise the hash is a lie and deduplication breaks.
 *
 * Use this for ALL file content hashing.
 */
function hashBuffer(buffer) {
  return crypto.createHash('sha1').update(buffer).digest('hex');
}

/**
 * hashContent — hashes a UTF-8 string.
 *
 * ONLY use this for structured data that is always a string:
 *   - Commit object JSON (always serialized as UTF-8 text)
 *   - Index entries (JSON)
 *
 * Do NOT use this for file content. Use hashBuffer() instead.
 */
function hashContent(content) {
  return crypto.createHash('sha1').update(content, 'utf-8').digest('hex');
}

/**
 * Produces a short 8-char prefix of a full hash.
 * Suitable for human-readable display (like `git log --oneline`).
 */
function shortHash(fullHash) {
  return fullHash ? fullHash.substring(0, 8) : '(none)';
}

module.exports = { hashBuffer, hashContent, shortHash };
