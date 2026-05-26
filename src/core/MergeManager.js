'use strict';

const path = require('path');
const chalk = require('chalk');

const MergeBaseResolver = require('./MergeBaseResolver');
const { readFile, writeFile } = require('../utils/fileUtils');

class MergeManager {
  constructor(repo) {
    this.repo = repo;

    this.baseResolver = new MergeBaseResolver(repo.commits);
  }

  async merge(targetBranch, options = {}) {
    const head = await this.repo.refs.readHead();

    if (head.type !== 'branch') {
      throw new Error('Cannot merge in detached HEAD state');
    }

    const currentBranch = head.name;

    if (currentBranch === targetBranch) {
      throw new Error('Cannot merge a branch into itself');
    }

    const currentHash = await this.repo.refs.getBranchHead(currentBranch);
    const targetHash = await this.repo.refs.getBranchHead(targetBranch);

    if (!targetHash) {
      throw new Error(`Branch "${targetBranch}" does not exist`);
    }

    const mergeBase =
      await this.baseResolver.findMergeBase(currentHash, targetHash);

    if (mergeBase === targetHash) {
      return {
        type: 'ALREADY_UP_TO_DATE',
      };
    }

    if (mergeBase === currentHash && !options.noFastForward) {
      await this.repo.refs.updateBranch(currentBranch, targetHash);

      const targetCommit =
        await this.repo.commits.retrieve(targetHash);

      await this.restoreWorkingTree(targetCommit);

      return {
        type: 'FAST_FORWARD',
        from: currentBranch,
        to: targetBranch,
      };
    }

    const baseCommit =
      mergeBase ? await this.repo.commits.retrieve(mergeBase) : null;

    const currentCommit =
      await this.repo.commits.retrieve(currentHash);

    const targetCommit =
      await this.repo.commits.retrieve(targetHash);

    const result =
      await this.performThreeWayMerge(
        baseCommit,
        currentCommit,
        targetCommit
      );

    if (result.conflicts.length > 0) {
      return {
        type: 'CONFLICT',
        conflicts: result.conflicts,
      };
    }

    const mergeCommit = {
      message: `Merge branch "${targetBranch}" into ${currentBranch}`,
      timeStamp: new Date().toISOString(),
      branch: currentBranch,
      parent: currentHash,
      parents: [currentHash, targetHash],
      files: result.files,
    };

    const mergeHash =
      await this.repo.commits.store(mergeCommit);

    await this.repo.refs.updateBranch(currentBranch, mergeHash);

    return {
      type: 'MERGE_COMMIT',
      commitHash: mergeHash.slice(0, 8),
    };
  }

  async performThreeWayMerge(base, current, incoming) {
    const conflicts = [];

    const mergedFiles = [];

    const allPaths = new Set();

    for (const f of base?.files || []) {
      allPaths.add(f.path);
    }

    for (const f of current?.files || []) {
      allPaths.add(f.path);
    }

    for (const f of incoming?.files || []) {
      allPaths.add(f.path);
    }

    for (const filePath of allPaths) {
      const baseEntry =
        base?.files?.find(f => f.path === filePath);

      const currentEntry =
        current?.files?.find(f => f.path === filePath);

      const incomingEntry =
        incoming?.files?.find(f => f.path === filePath);

      const baseHash = baseEntry?.hash || null;
      const currentHash = currentEntry?.hash || null;
      const incomingHash = incomingEntry?.hash || null;

      if (currentHash === incomingHash) {
        if (currentEntry) mergedFiles.push(currentEntry);
        continue;
      }

      if (baseHash === currentHash) {
        if (incomingEntry) mergedFiles.push(incomingEntry);
        continue;
      }

      if (baseHash === incomingHash) {
        if (currentEntry) mergedFiles.push(currentEntry);
        continue;
      }

      conflicts.push(filePath);

      const currentContent =
        currentEntry
          ? await this.repo.blobs.retrieve(currentEntry.hash)
          : '';

      const incomingContent =
        incomingEntry
          ? await this.repo.blobs.retrieve(incomingEntry.hash)
          : '';

      const mergedContent =
`<<<<<<< CURRENT
${currentContent}
=======
${incomingContent}
>>>>>>> INCOMING
`;

      await writeFile(
        this.repo.resolvePath(filePath),
        mergedContent
      );
    }

    return {
      files: mergedFiles,
      conflicts,
    };
  }

  async restoreWorkingTree(commit) {
    for (const file of commit.files || []) {
      const content =
        await this.repo.blobs.retrieve(file.hash);

      await writeFile(
        this.repo.resolvePath(file.path),
        content
      );
    }
  }
}

module.exports = MergeManager;