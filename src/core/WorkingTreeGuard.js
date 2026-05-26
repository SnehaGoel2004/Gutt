'use strict';

const path = require('path');
const fs   = require('fs').promises;
const { hashBuffer } = require('../utils/hashUtils');

/**
 * WorkingTreeGuard — detects uncommitted changes before destructive operations.
 *
 * DESIGN RATIONALE:
 * Checkout and restore both overwrite working-directory files. If a user has
 * unsaved work, silently overwriting it is data loss. Git refuses checkout
 * when the working tree is dirty. Gutt does the same with a friendlier message.
 *
 * This is a reusable helper so the same check runs in both checkout.js
 * and restore.js without duplicating logic.
 *
 * Detection covers:
 *   1. Staged but uncommitted files (index is non-empty)
 *   2. Tracked files modified in the working directory (hash mismatch vs HEAD)
 *
 * Returns: { clean: bool, staged: string[], modified: string[] }
 */
async function hasWorkingTreeChanges(repo) {
  const IndexManager = require('./IndexManager');
  const index  = new IndexManager(repo.indexPath);
  const staged = await index.read();

  // Any staged files = working tree is dirty
  if (staged.length > 0) {
    return {
      clean:    false,
      staged:   staged.map(s => s.path),
      modified: [],
    };
  }

  // Walk committed tree and compare each file to working directory
  const headHash = await repo.refs.resolveHead();
  if (!headHash) return { clean: true, staged: [], modified: [] };

  const committedFiles = new Map();
  let cur = headHash;
  while (cur) {
    const commit = await repo.commits.retrieve(cur);
    if (!commit) break;
    for (const f of (commit.files || [])) {
      if (!committedFiles.has(f.path)) committedFiles.set(f.path, f.hash);
    }
    cur = commit.parent || null;
  }

  const modified = [];
  for (const [filePath, committedHash] of committedFiles) {
    const absPath = path.join(repo.workingDir, filePath);
    try {
      const buf  = await fs.readFile(absPath);
      const hash = hashBuffer(buf);
      if (hash !== committedHash) modified.push(filePath);
    } catch { /* file missing — not a modification */ }
  }

  return {
    clean:    modified.length === 0,
    staged:   [],
    modified,
  };
}

module.exports = { hasWorkingTreeChanges };
