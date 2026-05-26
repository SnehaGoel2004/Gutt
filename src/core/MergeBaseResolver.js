'use strict';

/**
 * MergeBaseResolver
 *
 * Finds the lowest common ancestor (merge base)
 * between two commits.
 *
 * Example:
 *
 * A --- B --- C main
 *        \
 *         D --- E feature
 *
 * merge-base(main, feature) = B
 *
 * This is required for:
 *   - real 3-way merges
 *   - conflict detection
 *   - fast-forward detection
 *   - DAG traversal
 */

class MergeBaseResolver {
  constructor(commits) {
    this.commits = commits;
  }

  /**
   * Collect all ancestors of a commit.
   *
   * Returns:
   *   Set<commitHash>
   */
  async collectAncestors(startHash) {
    const visited = new Set();

    let current = startHash;

    while (current) {
      if (visited.has(current)) break;

      visited.add(current);

      const commit = await this.commits.retrieve(current);
      if (!commit) break;

      // Traverse primary parent chain
      current = commit.parent || null;
    }

    return visited;
  }

  /**
   * Find lowest common ancestor between two commits.
   *
   * Returns:
   *   commit hash OR null
   */
  async findMergeBase(hashA, hashB) {
    if (!hashA || !hashB) return null;

    // Collect all ancestors from branch A
    const ancestorsA = await this.collectAncestors(hashA);

    // Walk branch B upward until overlap found
    let current = hashB;

    while (current) {
      if (ancestorsA.has(current)) {
        return current;
      }

      const commit = await this.commits.retrieve(current);
      if (!commit) break;

      current = commit.parent || null;
    }

    return null;
  }

  /**
   * Fast-forward detection.
   *
   * Returns true if:
   *   target branch already contains current branch
   *
   * Meaning:
   *   current branch can simply move forward
   *   without creating a merge commit.
   */
  async isAncestor(ancestorHash, descendantHash) {
    let current = descendantHash;

    while (current) {
      if (current === ancestorHash) {
        return true;
      }

      const commit = await this.commits.retrieve(current);
      if (!commit) break;

      current = commit.parent || null;
    }

    return false;
  }
}

module.exports = MergeBaseResolver;