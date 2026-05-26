'use strict';

const path = require('path');
const { readFile, writeFile, exists } = require('../utils/fileUtils');
const fs = require('fs').promises;

/**
 * RefStorage manages symbolic references — names that point to commit hashes.
 *
 * Structure mirrors Git's ref model:
 *   .gutt/refs/heads/<branch-name>   → contains a commit hash
 *   .gutt/HEAD                        → contains the current branch name
 *                                       e.g. "ref: refs/heads/main"
 *
 * Why refs?
 * - Commit hashes are not human-friendly.
 * - Refs let users work with names ("main", "feature-x") rather than hashes.
 * - This is the foundation of branching.
 */
class RefStorage {
  constructor(gutRepoPath) {
    this.repoPath = gutRepoPath;
    this.headsPath = path.join(gutRepoPath, 'refs', 'heads');
    this.headFilePath = path.join(gutRepoPath, 'HEAD');
  }

  // ── HEAD management ──────────────────────────────────────────────────────

  /**
   * Reads the current HEAD.
   * Returns { type: 'branch', name } or { type: 'detached', hash }.
   */
  async readHead() {
    const content = await readFile(this.headFilePath);
    if (!content) return { type: 'branch', name: 'main' };

    const trimmed = content.trim();
    if (trimmed.startsWith('ref: ')) {
      // e.g. "ref: refs/heads/main"
      const refPath = trimmed.slice(5);
      const name = refPath.replace('refs/heads/', '');
      return { type: 'branch', name };
    }

    // Detached HEAD — points directly at a commit hash
    return { type: 'detached', hash: trimmed };
  }

  /**
   * Points HEAD at a branch name.
   */
  async setHeadToBranch(branchName) {
    await writeFile(this.headFilePath, `ref: refs/heads/${branchName}\n`);
  }

  /**
   * Points HEAD directly at a commit hash (detached HEAD state).
   */
  async setHeadToHash(commitHash) {
    await writeFile(this.headFilePath, commitHash + '\n');
  }

  /**
   * Resolves HEAD to a commit hash.
   * If HEAD points to a branch, resolves through the branch ref.
   * Returns null if no commits exist yet.
   */
  async resolveHead() {
    const head = await this.readHead();
    if (head.type === 'detached') return head.hash;
    return this.resolveBranch(head.name);
  }

  // ── Branch ref management ────────────────────────────────────────────────

  /**
   * Returns the commit hash a branch points to. Null if branch doesn't exist.
   */
  async resolveBranch(branchName) {
    const refPath = path.join(this.headsPath, branchName);
    const content = await readFile(refPath);
    return content ? content.trim() : null;
  }

  /**
   * Updates (or creates) a branch to point at a commit hash.
   */
  async updateBranch(branchName, commitHash) {
    const refPath = path.join(this.headsPath, branchName);
    await writeFile(refPath, commitHash + '\n');
  }

  /**
   * Returns all branch names.
   */
  async listBranches() {
    try {
      const entries = await fs.readdir(this.headsPath, { withFileTypes: true });
      return entries.filter(e => e.isFile()).map(e => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Deletes a branch ref. Does not affect commits.
   */
  async deleteBranch(branchName) {
    const refPath = path.join(this.headsPath, branchName);
    try {
      await fs.unlink(refPath);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }

  /**
   * Returns true if a branch with this name exists.
   */
  async branchExists(branchName) {
    return exists(path.join(this.headsPath, branchName));
  }
}

module.exports = RefStorage;
