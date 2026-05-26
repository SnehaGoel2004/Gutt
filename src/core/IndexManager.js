'use strict';

const { readFile, writeFile } = require('../utils/fileUtils');

/**
 * IndexManager owns the staging area — .gutt/index.
 *
 * The index is a JSON array of staged entries:
 *   [ { path: "src/auth.js", hash: "abc123..." }, ... ]
 *
 * Each entry represents a file AT THE VERSION it was staged.
 * When you run `gutt add`, you're writing to the index.
 * When you run `gutt commit`, you're reading from it and clearing it.
 *
 * Why a dedicated class?
 * The index is read/written by add, commit, status, and unstage commands.
 * Centralizing the read/write logic here means:
 *   - one place to change the format
 *   - one place to add validation
 *   - all commands share the same deserialization logic
 */
class IndexManager {
  constructor(indexPath) {
    this.indexPath = indexPath;
  }

  /**
   * Reads the current staging area. Returns [] if empty or missing.
   */
  async read() {
    const raw = await readFile(this.indexPath);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }

  /**
   * Writes a new staging area state to disk.
   */
  async write(entries) {
    await writeFile(this.indexPath, JSON.stringify(entries, null, 2));
  }

  /**
   * Adds or updates a single entry in the index.
   * If the file is already staged, its hash is updated (re-stage).
   */
  async stage(filePath, hash) {
    const entries = await this.read();
    const existingIdx = entries.findIndex(e => e.path === filePath);
    if (existingIdx >= 0) {
      entries[existingIdx].hash = hash;
    } else {
      entries.push({ path: filePath, hash });
    }
    await this.write(entries);
  }

  /**
   * Removes a single entry from the index by file path.
   * Returns true if the entry was found and removed, false otherwise.
   */
  async unstage(filePath) {
    const entries = await this.read();
    const filtered = entries.filter(e => e.path !== filePath);
    if (filtered.length === entries.length) return false;
    await this.write(filtered);
    return true;
  }

  /**
   * Clears the entire staging area.
   * Called after a successful commit.
   */
  async clear() {
    await this.write([]);
  }

  /**
   * Returns true if a specific file path is currently staged.
   */
  async isStaged(filePath) {
    const entries = await this.read();
    return entries.some(e => e.path === filePath);
  }
}

module.exports = IndexManager;
