'use strict';

const path     = require('path');
const fs       = require('fs').promises;
const readline = require('readline');
const chalk    = require('chalk');
const CheckoutManager              = require('../core/CheckoutManager');
const { hasWorkingTreeChanges }    = require('../core/WorkingTreeGuard');
const { hashBuffer, shortHash }    = require('../utils/hashUtils');

/**
 * `gutt restore <commitHash>`
 *
 * Safely restores working tree files from a historical commit
 * WITHOUT switching branches or moving HEAD.
 *
 * How this differs from `gutt checkout`:
 *   checkout  — switches your active branch and moves HEAD
 *   restore   — copies files from history into your working tree,
 *               leaves HEAD and branch pointer untouched
 *
 * This is the beginner-safe version of Git's `git restore` /
 * `git checkout -- <file>` which are notoriously confusing.
 *
 * Workflow:
 *   1. Resolve commit hash
 *   2. Build the full file tree at that commit (via history walk)
 *   3. Diff against current working directory
 *   4. Show restore plan with overwrite warnings
 *   5. Confirm with user (unless --force)
 *   6. Write files
 */
async function restoreCommand(commitHash, { force = false, preview = false } = {}, repo) {
  // Guard: warn if working tree has uncommitted changes — restore will overwrite files.
  // --preview skips the guard (it's read-only), --force bypasses it explicitly.
  if (!force && !preview) {
    const state = await hasWorkingTreeChanges(repo);
    if (!state.clean) {
      console.log(chalk.yellow('\n  ⚠  Uncommitted changes detected.\n'));
      if (state.staged.length > 0) {
        console.log(chalk.yellow('  Staged (not committed):'));
        state.staged.forEach(f => console.log(chalk.yellow(`    • ${f}`)));
      }
      if (state.modified.length > 0) {
        console.log(chalk.yellow('  Modified (not staged):'));
        state.modified.forEach(f => console.log(chalk.yellow(`    • ${f}`)));
      }
      console.log(chalk.cyan('\n  Commit or stash your work first, or use --force to override.\n'));
      return;
    }
  }

  // 1. Resolve abbreviated or full commit hash
  let commit, resolvedHash;
  try {
    ({ commit, hash: resolvedHash } = await repo.commits.retrieveByPrefix(commitHash));
  } catch (err) {
    // retrieveByPrefix throws typed errors for not_found and ambiguous
    console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    return;
  }

  console.log(chalk.bold.cyan('\n  SAFE RESTORE'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));
  console.log(chalk.gray(`  Source commit: ${shortHash(resolvedHash)}  "${commit.message}"`));
  console.log(chalk.gray(`  Branch pointer: unchanged (HEAD stays on current branch)\n`));

  // 2. Build full file tree at the target commit
  const mgr     = new CheckoutManager(repo.refs, repo.commits, repo.blobs, repo.workingDir);
  const fileMap = await mgr._buildFullTree(resolvedHash);

  if (fileMap.size === 0) {
    console.log(chalk.yellow('  No files in this commit tree.\n'));
    return;
  }

  // 3. Classify files: new, modified, unchanged
  const toRestore = [];
  const unchanged = [];

  for (const [filePath, blobHash] of fileMap) {
    const absPath = path.join(repo.workingDir, filePath);
    let currentHash = null;

    try {
      // Read as Buffer — same method add.js uses, so hashes will match
      const currentBuffer = await fs.readFile(absPath);
      currentHash = hashBuffer(currentBuffer);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      // File doesn't exist on disk — will be created
    }

    if (currentHash === blobHash) {
      unchanged.push(filePath);
    } else {
      toRestore.push({
        filePath,
        blobHash,
        exists: currentHash !== null,  // true = overwrite, false = new file
      });
    }
  }

  // 4. Render restore plan
  if (toRestore.length === 0) {
    console.log(chalk.green('  ✔ Working tree already matches this commit. Nothing to restore.\n'));
    return;
  }

  const overwrites = toRestore.filter(f => f.exists);
  const newFiles   = toRestore.filter(f => !f.exists);

  if (newFiles.length > 0) {
    console.log(chalk.green(`  Files to create (${newFiles.length}):`));
    for (const f of newFiles) {
      console.log(chalk.green(`    + ${f.filePath}`));
    }
  }

  if (overwrites.length > 0) {
    console.log(chalk.yellow(`\n  Files to overwrite (${overwrites.length}) — current changes will be lost:`));
    for (const f of overwrites) {
      console.log(chalk.yellow(`    ~ ${f.filePath}`));
    }
  }

  if (unchanged.length > 0) {
    console.log(chalk.gray(`\n  Unchanged: ${unchanged.length} file(s) (skipped)`));
  }

  if (preview) {
    console.log(chalk.cyan('\n  Preview only — no files written. Run without --preview to restore.\n'));
    return;
  }

  // 5. Confirm (unless --force)
  if (!force && overwrites.length > 0) {
    const answer = await promptUser(
      chalk.yellow(`\n  Overwrite ${overwrites.length} modified file(s)? `) +
      chalk.gray('[y/N] ')
    );
    if (answer.toLowerCase() !== 'y') {
      console.log(chalk.gray('\n  Restore cancelled.\n'));
      return;
    }
  }

  // 6. Write files
  let written = 0;
  for (const { filePath, blobHash } of toRestore) {
    const buffer = await repo.blobs.retrieveBuffer(blobHash);
    if (buffer === null) {
      console.log(chalk.red(`  ✗ Blob missing for ${filePath} — skipping`));
      continue;
    }
    const targetPath = path.join(repo.workingDir, filePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    written++;
  }

  console.log(chalk.bold.green(`\n  ✔  Restored ${written} file(s) from commit ${shortHash(resolvedHash)}`));
  console.log(chalk.gray('     HEAD and branch pointer are unchanged.\n'));
}

function promptUser(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

module.exports = restoreCommand;
