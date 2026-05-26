'use strict';

const path = require('path');
const fs   = require('fs').promises;

/**
 * CheckoutManager — branch switching and working-tree synchronization.
 *
 * FULL WORKING TREE SYNC:
 * A correct VCS checkout has three distinct operations:
 *
 *   1. RESTORE  — write every file tracked in the TARGET tree to disk
 *   2. REMOVE   — delete files tracked in the CURRENT tree that do not
 *                 exist in the TARGET tree
 *   3. PRESERVE — never touch untracked files (files not in either tree)
 *
 * The previous implementation only did step 1. This meant files created
 * on a feature branch and committed there would persist on disk after
 * switching back to main — because nothing removed them.
 *
 * WHY "CURRENT TREE" MATTERS FOR DELETION:
 * We can't just delete everything not in the target tree — that would
 * destroy untracked files the user hasn't committed yet.
 * We must only remove files that are TRACKED (i.e. appear somewhere in
 * the commit history of the branch being left). Those files belong to
 * the VCS and it is safe and correct to remove them on branch switch.
 *
 * ENCODING:
 * All file reads and writes use raw Buffer with no encoding conversion.
 * This preserves binary files, BOMs, emoji, and multibyte Unicode exactly.
 */
class CheckoutManager {
  constructor(refs, commits, blobs, workingDir) {
    this.refs       = refs;
    this.commits    = commits;
    this.blobs      = blobs;
    this.workingDir = workingDir;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  async checkoutBranch(branchName) {
    if (!await this.refs.branchExists(branchName)) {
      throw new Error(
        `Branch "${branchName}" does not exist.\n` +
        `Create it first: gutt branch ${branchName}`
      );
    }

    const targetCommitHash = await this.refs.resolveBranch(branchName);
    if (!targetCommitHash) {
      // Branch exists but has no commits — just move HEAD, nothing to restore
      await this.refs.setHeadToBranch(branchName);
      return { type: 'branch', name: branchName, commitHash: null, filesRestored: 0, filesRemoved: 0 };
    }

    const result = await this._syncWorkingTree(targetCommitHash);
    await this.refs.setHeadToBranch(branchName);

    return {
      type:         'branch',
      name:         branchName,
      commitHash:   targetCommitHash,
      filesRestored: result.restored,
      filesRemoved:  result.removed,
    };
  }

  async checkoutCommit(commitHash) {
    const commit = await this.commits.retrieve(commitHash);
    if (!commit) {
      throw new Error(
        `Commit "${commitHash}" not found.\n` +
        `Use 'gutt log' to see valid commit hashes.`
      );
    }

    const result = await this._syncWorkingTree(commitHash);
    await this.refs.setHeadToHash(commitHash);

    return {
      type:          'detached',
      commitHash,
      filesRestored: result.restored,
      filesRemoved:  result.removed,
    };
  }

  async restoreCheckpoint(checkpoint) {
    if (!checkpoint.headHash) {
      throw new Error('This checkpoint has no associated commit to restore to.');
    }
    const result = await this._syncWorkingTree(checkpoint.headHash);
    await this.refs.setHeadToHash(checkpoint.headHash);
    return { filesRestored: result.restored, filesRemoved: result.removed };
  }

  // ── Core: working-tree synchronization ──────────────────────────────────

  /**
   * Synchronizes the working directory to exactly match the target commit tree.
   *
   * Algorithm:
   *   currentTree = full file map of the currently checked-out HEAD
   *   targetTree  = full file map of the commit being checked out
   *
   *   For each path in targetTree:  write file to disk (restore)
   *   For each path in currentTree: if NOT in targetTree → delete from disk
   *   Untracked files (in neither tree) are never touched.
   *
   * Returns { restored: number, removed: number }
   */
  async _syncWorkingTree(targetCommitHash) {
    // Build the target file tree (where we're going)
    const targetTree = await this._getCommitTree(targetCommitHash);

    // Build the current file tree (where we are now).
    // If HEAD is unresolvable (fresh repo, detached, etc.) treat as empty.
    const currentCommitHash = await this.refs.resolveHead().catch(() => null);
    const currentTree = currentCommitHash
      ? await this._getCommitTree(currentCommitHash)
      : new Map();

    let restored = 0;
    let removed  = 0;

    // STEP 1: Write every file in the target tree to disk.
    for (const [filePath, blobHash] of targetTree) {
      const buffer = await this.blobs.retrieveBuffer(blobHash);
      if (buffer === null) continue; // missing blob — skip gracefully
      await this._writeBuffer(path.join(this.workingDir, filePath), buffer);
      restored++;
    }

    // STEP 2: Remove files that are tracked in the current tree but absent
    // from the target tree. These files belong to the branch being left —
    // they must be removed so the working directory reflects the target branch.
    //
    // We ONLY remove files present in currentTree. Files not in currentTree
    // are untracked by the VCS and must be left untouched.
    for (const filePath of currentTree.keys()) {
      if (!targetTree.has(filePath)) {
        const absPath = path.join(this.workingDir, filePath);
        try {
          await fs.unlink(absPath);
          removed++;

          // Clean up empty parent directories left behind.
          // This mirrors Git's behavior — checking out to a branch that
          // never had "src/feature/" removes the empty src/feature/ dir.
          await this._pruneEmptyDirs(path.dirname(absPath));
        } catch (err) {
          // ENOENT is fine — file was already gone (e.g. manually deleted)
          if (err.code !== 'ENOENT') throw err;
        }
      }
    }

    return { restored, removed };
  }

  /**
   * Walks the commit chain from startHash and builds a Map<path, blobHash>
   * representing the complete committed file state at that point.
   *
   * Newest commit wins: if auth.js appears in commit 3 and commit 1,
   * commit 3's version is used (it was the most recent change).
   */
  // async _buildFullTree(startHash) {
  //   const fileMap = new Map();
  //   let current   = startHash;

  //   while (current) {
  //     const commit = await this.commits.retrieve(current);
  //     if (!commit) break;

  //     for (const entry of (commit.files || [])) {
  //       if (!fileMap.has(entry.path)) {
  //         fileMap.set(entry.path, entry.hash);
  //       }
  //     }

  //     current = commit.parent || null;
  //   }

  //   return fileMap;
  // }
  async _getCommitTree(commitHash) {
    if (!commitHash) {
      return new Map();
    }
    const commit =
      await this.commits.retrieve(commitHash);
    if (!commit) {
      return new Map();
    }
    
    return new Map(
      (commit.files || []).map(file => [
        file.path,
        file.hash
      ])
    );
  }

  /**
   * Writes a Buffer to disk with no encoding transformation.
   * Creates parent directories automatically.
   *
   * WHY NO ENCODING: any encoding step risks corrupting binary files,
   * BOMs, or multibyte Unicode. Raw buffer write is the only safe option.
   */
  async _writeBuffer(targetPath, buffer) {
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
  }

  /**
   * Walks up the directory tree from `dir` toward workingDir,
   * removing each directory that is now empty.
   * Stops at workingDir itself — never removes the repo root.
   */
  async _pruneEmptyDirs(dir) {
    while (dir !== this.workingDir && dir.startsWith(this.workingDir)) {
      let entries;
      try {
        entries = await fs.readdir(dir);
      } catch {
        break;
      }
      if (entries.length > 0) break; // not empty — stop
      try {
        await fs.rmdir(dir);
      } catch {
        break;
      }
      dir = path.dirname(dir);
    }
  }
}

module.exports = CheckoutManager;
