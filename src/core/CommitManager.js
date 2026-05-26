// 'use strict';

// /**
//  * CommitManager orchestrates the multi-step commit pipeline.
//  *
//  * Why a dedicated manager instead of putting this in a command?
//  * The commit operation touches FOUR subsystems:
//  *   1. IndexManager   — reads staged files, then clears them
//  *   2. BlobStorage    — verifies blobs exist (they were stored during `add`)
//  *   3. CommitStorage  — creates the commit object
//  *   4. RefStorage     — advances the current branch to the new commit
//  *
//  * Putting all this coordination in a command file would violate separation
//  * of concerns. The command layer should only handle CLI I/O.
//  * CommitManager handles the business logic of "what does a commit mean."
//  */
// class CommitManager {
//   constructor(index, blobs, commits, refs) {
//     this.index   = index;
//     this.blobs   = blobs;
//     this.commits = commits;
//     this.refs    = refs;
//   }

//   /**
//    * Executes a commit. Returns a result object describing what happened.
//    *
//    * Result shape:
//    * {
//    *   success: true,
//    *   commitHash: "abc123...",
//    *   message: "...",
//    *   branch: "main",
//    *   stats: { totalFiles, newBlobs, deduplicatedBlobs, addedLines, removedLines }
//    * }
//    */
//   async commit(message, options = {}) {
//     // 1. Read staging area
//     const staged = await this.index.read();
    
    
//     if (staged.length === 0) {
//       return { success: false, reason: 'EMPTY_STAGE' };
//     }

//     // 2. Resolve current HEAD
//     const parentHash = await this.refs.resolveHead();
//     const parentCommit = parentHash ? await this.commits.retrieve(parentHash) : null;
//     const parentFiles = parentCommit.files || [];

//     // 3. Duplicate commit prevention
//     //    If every staged file matches the parent snapshot exactly, nothing changed.
//     if (parentCommit) {
      
//       const isIdentical =
//         staged.length === parentFiles.length &&
//         staged.every(f => parentFiles.some(p => p.path === f.path && p.hash === f.hash));
//       if (isIdentical) {
//         return { success: false, reason: 'NO_CHANGES' };
//       }
//     }

//     // 4. Calculate deduplication stats
//     //    Count how many staged files are blobs already in storage (unchanged since last commit)
//     const parentFileMap = new Map((parentCommit?.files || []).map(f => [f.path, f.hash]));
//     let deduplicatedBlobs = 0;
//     for (const entry of staged) {
//       if (parentFileMap.get(entry.path) === entry.hash) {
//         deduplicatedBlobs++;
//       }
//     }

//     // 5. Determine current branch
//     const head   = await this.refs.readHead();
//     const branch = head.type === 'branch' ? head.name : null;

//     // 6. Build and store the commit object
//     // Normal commits:
//     //   parent = previous HEAD
//     // Merge commits:
//     //   parent      = current branch HEAD
//     //   mergeParent = merged branch HEAD
//     // This creates a REAL DAG history graph instead of a linear chain.
//     const snapshotMap = new Map();
//     for (const file of parentFiles) {
//       snapshotMap.set(file.path, file.hash);
//     }
//     for (const file of staged) {
//       snapshotMap.set(file.path, file.hash);
//     }
    
//     const fullSnapshot =
//       Array.from(snapshotMap.entries())
//         .map(([path, hash]) => ({ path, hash }));

//     const commitObject = {
//       message,
//       timeStamp: new Date().toISOString(),
//       files:     fullSnapshot,
//       parent:    parentHash || null,
//       mergeParent: options.mergeParent || null,
//       branch:    branch || 'detached',
//     };

//     const commitHash = await this.commits.store(commitObject);

//     // 7. Advance the branch ref (or update detached HEAD)
//     if (branch) {
//       await this.refs.updateBranch(branch, commitHash);
//     } else {
//       await this.refs.setHeadToHash(commitHash);
//     }

//     // 8. Clear the staging area
//     await this.index.clear();

//     return {
//       success: true,
//       commitHash,
//       message,
//       branch: branch || 'detached',
//       mergeParent: options.mergeParent || null,
//       stats: {
//         totalFiles:        staged.length,
//         deduplicatedBlobs,
//         newBlobs:          staged.length - deduplicatedBlobs,
//       },
//     };
//   }
// }

// module.exports = CommitManager;



'use strict';

/**
 * CommitManager orchestrates the multi-step commit pipeline.
 *
 * Responsibilities:
 *   1. Read staged changes
 *   2. Resolve current HEAD
 *   3. Build FULL repository snapshot
 *   4. Store commit object
 *   5. Advance refs
 *   6. Clear staging area
 *
 * IMPORTANT:
 * Commits store COMPLETE snapshots.
 * This guarantees:
 *   - reliable checkout
 *   - reliable clone
 *   - branch consistency
 *   - deterministic restores
 */

class CommitManager {

  constructor(index, blobs, commits, refs) {
    this.index = index;
    this.blobs = blobs;
    this.commits = commits;
    this.refs = refs;
  }

  /**
   * Executes commit operation.
   */
  async commit(message, options = {}) {

    // ------------------------------------------------
    // Read staged files
    // ------------------------------------------------

    const staged =
      await this.index.read();

    // ------------------------------------------------
    // Resolve parent commit
    // ------------------------------------------------

    const parentHash =
      await this.refs.resolveHead();

    const parentCommit =
      parentHash
        ? await this.commits.retrieve(parentHash)
        : null;

    const parentFiles =
      parentCommit?.files || [];

    // ------------------------------------------------
    // Build parent snapshot map
    // ------------------------------------------------

    const snapshotMap = new Map();

    for (const file of parentFiles) {
      snapshotMap.set(file.path, file.hash);
    }

    // ------------------------------------------------
    // Apply staged changes onto snapshot
    // ------------------------------------------------

    for (const file of staged) {
      snapshotMap.set(file.path, file.hash);
    }

    // ------------------------------------------------
    // Final full snapshot
    // ------------------------------------------------

    const fullSnapshot =
      Array.from(snapshotMap.entries())
        .map(([path, hash]) => ({
          path,
          hash
        }));

    // ------------------------------------------------
    // Prevent empty/no-op commits
    // ------------------------------------------------

    const snapshotUnchanged =
      parentFiles.length === fullSnapshot.length &&
      fullSnapshot.every(file =>
        parentFiles.some(
          parent =>
            parent.path === file.path &&
            parent.hash === file.hash
        )
      );

    if (snapshotUnchanged) {
      return {
        success: false,
        reason: 'NO_CHANGES'
      };
    }

    // ------------------------------------------------
    // Deduplication analytics
    // ------------------------------------------------

    const parentFileMap =
      new Map(
        parentFiles.map(f => [f.path, f.hash])
      );

    let deduplicatedBlobs = 0;

    for (const file of fullSnapshot) {

      if (
        parentFileMap.get(file.path) === file.hash
      ) {
        deduplicatedBlobs++;
      }
    }

    // ------------------------------------------------
    // Resolve branch
    // ------------------------------------------------

    const head =
      await this.refs.readHead();

    const branch =
      head.type === 'branch'
        ? head.name
        : null;

    // ------------------------------------------------
    // Create commit object
    // ------------------------------------------------

    const commitObject = {

      message,

      timeStamp:
        new Date().toISOString(),

      files:
        fullSnapshot,

      parent:
        parentHash || null,

      mergeParent:
        options.mergeParent || null,

      branch:
        branch || 'detached'
    };

    // ------------------------------------------------
    // Store commit
    // ------------------------------------------------

    const commitHash =
      await this.commits.store(commitObject);

    // ------------------------------------------------
    // Advance refs
    // ------------------------------------------------

    if (branch) {

      await this.refs.updateBranch(
        branch,
        commitHash
      );

    } else {

      await this.refs.setHeadToHash(
        commitHash
      );
    }

    // ------------------------------------------------
    // Clear staging area
    // ------------------------------------------------

    await this.index.clear();

    // ------------------------------------------------
    // Return commit result
    // ------------------------------------------------

    return {

      success: true,

      commitHash,

      message,

      branch:
        branch || 'detached',

      mergeParent:
        options.mergeParent || null,

      stats: {

        totalFiles:
          fullSnapshot.length,

        stagedFiles:
          staged.length,

        deduplicatedBlobs,

        newBlobs:
          fullSnapshot.length - deduplicatedBlobs
      }
    };
  }
}

module.exports = CommitManager;