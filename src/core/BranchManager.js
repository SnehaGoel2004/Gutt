'use strict';

/**
 * BranchManager handles all branch lifecycle operations.
 *
 * It wraps RefStorage with higher-level branch semantics:
 * - validation (can't delete current branch)
 * - error messaging
 * - creation from current HEAD
 *
 * RefStorage knows HOW to store refs.
 * BranchManager knows WHAT is valid to do with branches.
 */
class BranchManager {
  constructor(refs) {
    this.refs = refs;
  }

  /**
   * Creates a new branch pointing at the current HEAD commit.
   * Throws if the branch already exists.
   */
  async create(branchName) {
    if (await this.refs.branchExists(branchName)) {
      throw new Error(`Branch "${branchName}" already exists.`);
    }

    const currentCommit = await this.refs.resolveHead();
    if (!currentCommit) {
      throw new Error('Cannot create a branch before making the first commit.');
    }

    await this.refs.updateBranch(branchName, currentCommit);
    return { branchName, commitHash: currentCommit };
  }

  /**
   * Returns a list of all branch names and which is current.
   */
  async list() {
    const head    = await this.refs.readHead();
    const names   = await this.refs.listBranches();
    const current = head.type === 'branch' ? head.name : null;

    return names.map(name => ({
      name,
      isCurrent: name === current,
      hash: null, // callers can resolve if needed
    }));
  }

  /**
   * Deletes a branch. Refuses to delete the currently checked-out branch.
   */
  async delete(branchName) {
    const head = await this.refs.readHead();
    if (head.type === 'branch' && head.name === branchName) {
      throw new Error(
        `Cannot delete branch "${branchName}" — it is currently checked out.\n` +
        `Switch to another branch first: gutt checkout <other-branch>`
      );
    }
    await this.refs.deleteBranch(branchName);
  }

  /**
   * Returns the name of the currently active branch.
   * Returns null if in detached HEAD state.
   */
  async currentBranch() {
    const head = await this.refs.readHead();
    return head.type === 'branch' ? head.name : null;
  }
}

module.exports = BranchManager;
