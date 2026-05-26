'use strict';

const chalk = require('chalk');

const MergeBaseResolver = require('../core/MergeBaseResolver');
const ThreeWayMerge     = require('../core/ThreeWayMerge');



const { writeFile } = require('../utils/fileUtils');

/**
 * gutt merge <branch>
 *
 * Supports:
 *   - fast-forward merges
 *   - real merge commits
 *   - conflict detection
 *   - conflict markers
 */

async function mergeCommand(targetBranch, repo) {

  // ---------------------------------------------------
  // Resolve current branch
  // ---------------------------------------------------

  const head = await repo.refs.readHead();

  if (head.type !== 'branch') {
    console.log(chalk.red('\n  ✗  Cannot merge in detached HEAD state.\n'));
    return;
  }

  const currentBranch = head.name;

  if (currentBranch === targetBranch) {
    console.log(chalk.red('\n  ✗  Cannot merge a branch into itself.\n'));
    return;
  }

  // ---------------------------------------------------
  // Resolve hashes
  // ---------------------------------------------------

  const currentHash = await repo.refs.resolveBranch(currentBranch);
  const targetHash  = await repo.refs.resolveBranch(targetBranch);

  if (!targetHash) {
    console.log(chalk.red(`\n  ✗  Branch not found: ${targetBranch}\n`));
    return;
  }

  // ---------------------------------------------------
  // Merge-base detection
  // ---------------------------------------------------

  const resolver = new MergeBaseResolver(repo.commits);

  const mergeBase = await resolver.findMergeBase(
    currentHash,
    targetHash
  );

  // ---------------------------------------------------
  // Fast-forward merge
  // ---------------------------------------------------

  const currentIsAncestor =
    await resolver.isAncestor(currentHash, targetHash);

  if (currentIsAncestor) {

    await repo.refs.updateBranch(currentBranch, targetHash);

    const targetCommit = await repo.commits.retrieve(targetHash);

    for (const file of targetCommit.files || []) {

      const raw = await repo.blobs.retrieve(file.hash);

      const buffer = Buffer.isBuffer(raw)
        ? raw
        : Buffer.from(raw || '', 'utf8');

      await writeFile(
        repo.resolvePath(file.path),
        buffer
      );
    }

    console.log(chalk.green('\n  ✔  Fast-forward merge completed.'));
    console.log(chalk.gray(`     ${currentBranch} → ${targetBranch}\n`));

    return;
  }

  // ---------------------------------------------------
  // Full 3-way merge
  // ---------------------------------------------------

  const baseCommit    = mergeBase
    ? await repo.commits.retrieve(mergeBase)
    : null;

  const currentCommit = await repo.commits.retrieve(currentHash);
  const targetCommit2 = await repo.commits.retrieve(targetHash);

  const mergeEngine = new ThreeWayMerge();

  const allPaths = new Set();

  for (const f of baseCommit?.files || []) {
    allPaths.add(f.path);
  }

  for (const f of currentCommit?.files || []) {
    allPaths.add(f.path);
  }

  for (const f of targetCommit2?.files || []) {
    allPaths.add(f.path);
  }

  let conflicts = 0;

  for (const filePath of allPaths) {

    const baseEntry =
      baseCommit?.files?.find(f => f.path === filePath);

    const currentEntry =
      currentCommit?.files?.find(f => f.path === filePath);

    const targetEntry =
      targetCommit2?.files?.find(f => f.path === filePath);

    const baseContent =
      baseEntry
        ? await repo.blobs.retrieve(baseEntry.hash)
        : '';

    const currentContent =
      currentEntry
        ? await repo.blobs.retrieve(currentEntry.hash)
        : '';

    const targetContent =
      targetEntry
        ? await repo.blobs.retrieve(targetEntry.hash)
        : '';

    const result = mergeEngine.merge(
      baseContent,
      currentContent,
      targetContent
    );

    if (result.conflict) {
      conflicts++;

      console.log(
        chalk.red(`  ⚠ Conflict: ${filePath}`)
      );
    }
    else {
      console.log(
        chalk.green(`  ✔ Merged: ${filePath}`)
      );
    }

    await writeFile(
      repo.resolvePath(filePath),
      result.merged
    );
  }

  // ---------------------------------------------------
  // Conflict stop
  // ---------------------------------------------------

  // if (conflicts > 0) {

  //   console.log(chalk.red('\n  Merge stopped due to conflicts.'));
  //   console.log(chalk.yellow('  Resolve conflicts manually.\n'));

  //   return;
  // }


  // ---------------------------------------------------
  // Conflict stop
  // ---------------------------------------------------
  if (conflicts > 0) {
    console.log(chalk.red('\n  Merge stopped due to conflicts.'));
    console.log(chalk.yellow('  Conflict markers written into files.'));
    console.log(chalk.yellow('  Resolve manually, then commit.\n'));
    return;
  }


  




  // ---------------------------------------------------
  // Stage merged files
  // ---------------------------------------------------

  const addCommand = require('./add');

  for (const filePath of allPaths) {
    await addCommand(filePath, repo);
  }

  // ---------------------------------------------------
  // Create merge commit
  // ---------------------------------------------------

  const CommitManager = require('../core/CommitManager');
  const IndexManager  = require('../core/IndexManager');
  const indexManager=new IndexManager(repo.indexPath);
  const manager = new CommitManager(
    indexManager,
    repo.blobs,
    repo.commits,
    repo.refs
  );

  const result = await manager.commit(
    `Merge branch "${targetBranch}" into ${currentBranch}`,
    {
      mergeParent: targetHash,
    }
  );

  console.log(chalk.green('\n  ✔  Merge completed successfully.'));
  console.log(
    chalk.gray(`     Merge commit: ${result.commitHash.slice(0, 8)}\n`)
  );
}

module.exports = mergeCommand;