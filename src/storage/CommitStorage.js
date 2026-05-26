'use strict';

const path = require('path');
const fs   = require('fs').promises;
const { readFile, writeFile, exists } = require('../utils/fileUtils');
const { hashContent } = require('../utils/hashUtils');

/**
 * CommitStorage manages commit objects.
 *
 * Storage: .gutt/objects/commits/<full-40-char-sha1>
 *
 * ABBREVIATED HASH RESOLUTION:
 * Git allows short hashes (e.g. "88d359b9") to refer to commits.
 * We implement the same by scanning the commits directory for filenames
 * that START WITH the provided prefix. The resolution rules are:
 *   - Exactly 1 match  → use it
 *   - 0 matches        → not found
 *   - 2+ matches       → ambiguous, show all matches to the user
 *
 * This is intentionally in CommitStorage (not in commands) so every
 * consumer — restore, show, checkout by hash — gets prefix resolution
 * automatically through the same code path.
 */
class CommitStorage {
  constructor(gutRepoPath) {
    this.commitsPath = path.join(gutRepoPath, 'objects', 'commits');
  }

  // ── Write ────────────────────────────────────────────────────────────────

  async store(commitObject) {
    const serialized = JSON.stringify(commitObject, null, 2);
    const hash       = hashContent(serialized);
    const commitPath = path.join(this.commitsPath, hash);

    if (!await exists(commitPath)) {
      await writeFile(commitPath, serialized);
    }

    return hash;
  }

  // ── Read — exact ─────────────────────────────────────────────────────────

  /**
   * Retrieves a commit by its FULL hash. Returns null if not found.
   * Use resolvePrefix() first when you have a user-supplied hash that
   * may be abbreviated.
   */
  async retrieve(hash) {
    if (!hash) return null;
    const raw = await readFile(path.join(this.commitsPath, hash));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  // ── Read — prefix resolution ─────────────────────────────────────────────

  /**
   * Resolves an abbreviated or full hash to a full commit hash.
   *
   * Returns one of:
   *   { status: 'found',     hash: '<full-hash>' }
   *   { status: 'not_found'                      }
   *   { status: 'ambiguous', matches: ['...', '...'] }
   *
   * Callers should switch on status and handle each case explicitly
   * rather than receiving a bare null — this forces correct error handling.
   */
  async resolvePrefix(prefix) {
    if (!prefix) return { status: 'not_found' };

    // If it's already a full 40-char hash, fast-path with direct lookup
    if (/^[0-9a-f]{40}$/i.test(prefix)) {
      const exists_ = await exists(path.join(this.commitsPath, prefix.toLowerCase()));
      return exists_
        ? { status: 'found', hash: prefix.toLowerCase() }
        : { status: 'not_found' };
    }

    // Scan the commits directory for filenames starting with the prefix
    let entries;
    try {
      entries = await fs.readdir(this.commitsPath);
    } catch {
      return { status: 'not_found' };
    }

    const lower   = prefix.toLowerCase();
    const matches = entries.filter(name => name.startsWith(lower));

    if (matches.length === 0) return { status: 'not_found' };
    if (matches.length === 1) return { status: 'found', hash: matches[0] };
    return { status: 'ambiguous', matches: matches.sort() };
  }

  /**
   * Convenience: resolve a user-supplied hash string and retrieve the commit.
   * Returns { commit, hash } on success, or throws a user-friendly Error.
   *
   * Use this in commands that accept a commit id from the user (restore, show).
   */
  async retrieveByPrefix(prefix) {
    const resolution = await this.resolvePrefix(prefix);

    if (resolution.status === 'not_found') {
      const err = new Error(`Commit "${prefix}" not found.\n  Run 'gutt log' to see valid commit IDs.`);
      err.code  = 'COMMIT_NOT_FOUND';
      throw err;
    }

    if (resolution.status === 'ambiguous') {
      const list = resolution.matches.map(h => `  ${h}`).join('\n');
      const err  = new Error(
        `Ambiguous commit hash "${prefix}" — ${resolution.matches.length} matches:\n${list}\n  Use more characters to disambiguate.`
      );
      err.code   = 'COMMIT_AMBIGUOUS';
      err.matches = resolution.matches;
      throw err;
    }

    const commit = await this.retrieve(resolution.hash);
    if (!commit) {
      const err = new Error(`Commit object for "${prefix}" exists but could not be read.`);
      err.code  = 'COMMIT_CORRUPT';
      throw err;
    }

    return { commit, hash: resolution.hash };
  }

  // ── History walk ─────────────────────────────────────────────────────────

  async getHistory(startHash) {
    const history = [];
    let current   = startHash;

    while (current) {
      const commit = await this.retrieve(current);
      if (!commit) break;
      history.push({ hash: current, ...commit });
      current = commit.parent || null;
    }

    return history;
  }
}

module.exports = CommitStorage;
