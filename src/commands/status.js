'use strict';

const path = require('path');
const fs = require('fs').promises;
const chalk = require('chalk');

const IndexManager = require('../core/IndexManager');
const {
  loadIgnorePatterns,
  isIgnored
} = require('../utils/ignoreUtils');

const {
  diffSummary
} = require('../utils/diffUtils');

const {
  shortHash,
  hashBuffer
} = require('../utils/hashUtils');

const {
  listAllFiles
} = require('../utils/fileUtils');

const WorkflowMetrics = require('../utils/workflowMetrics');

/**
 * gutt status
 */
async function statusCommand(repo) {

  // Read-only metrics — DO NOT track anything here
  const workflow = new WorkflowMetrics(repo.rootPath || repo.workingDir);

  const index = new IndexManager(repo.indexPath);
  const staged = await index.read();

  const headHash = await repo.refs.resolveHead();
  const userPatterns = await loadIgnorePatterns(repo.workingDir);
  const head = await repo.refs.readHead() || {};

  const committedFiles = await buildFullCommittedTree(headHash, repo);

  // ------------------------------------------------
  // HEADER
  // ------------------------------------------------

  const branchLabel =
    head.type === 'branch'
      ? chalk.bold.cyan(`On branch: ${head.name}`)
      : chalk.yellow(`HEAD detached at ${shortHash(head.hash || '')}`);

  console.log(`\n${branchLabel}`);

  if (headHash) {
    const headCommit = await repo.commits.retrieve(headHash);
    console.log(
      chalk.gray(`Last commit: ${shortHash(headHash)}  "${headCommit?.message}"`)
    );
  } else {
    console.log(chalk.gray('No commits yet.'));
  }

  console.log(chalk.gray('─'.repeat(50)));

  // ------------------------------------------------
  // 1. STAGED FILES
  // ------------------------------------------------

  if (staged.length > 0) {

    console.log(chalk.bold.green('\n  Changes staged for commit:'));
    console.log(chalk.gray('  (use "gutt unstage <file>" to unstage)\n'));

    for (const entry of staged) {

      const committed = committedFiles.get(entry.path);

      if (!committed) {
        const content = await repo.blobs.retrieve(entry.hash);
        const lines = content ? content.split('\n').length : 0;

        console.log(
          chalk.green(`    A  ${entry.path}`) +
          chalk.gray(`  (new file, ${lines} lines)`)
        );
        continue;
      }

      if (committed.hash !== entry.hash) {
        const prevContent = await repo.blobs.retrieve(committed.hash);
        const currContent = await repo.blobs.retrieve(entry.hash);
        const { added, removed } = diffSummary(prevContent || '', currContent || '');

        console.log(
          chalk.green(`    M  ${entry.path}`) +
          chalk.gray(`  (+${added} -${removed})`)
        );
        continue;
      }

      continue;
    }
  }

  // ------------------------------------------------
  // 2. MODIFIED / DELETED (UNSTAGED)
  // ------------------------------------------------

  const modifiedUnstaged = [];
  const deletedUnstaged = [];

  for (const [filePath, committed] of committedFiles) {

    if (staged.some(s => s.path === filePath)) continue;

    const absPath = path.join(repo.workingDir, filePath);

    try {
      const currentContent = await fs.readFile(absPath, 'utf8');
      const currentBuffer = await fs.readFile(absPath);
      const currentHash = hashBuffer(currentBuffer);

      if (currentHash !== committed.hash) {
        const prevContent = await repo.blobs.retrieve(committed.hash);
        const { added, removed } = diffSummary(prevContent || '', currentContent);
        modifiedUnstaged.push({ path: filePath, added, removed });
      }

    } catch (err) {
      if (err.code === 'ENOENT') {
        deletedUnstaged.push(filePath);
      }
    }
  }

  if (modifiedUnstaged.length > 0) {

    console.log(chalk.bold.yellow('\n  Changes not staged for commit:'));
    console.log(chalk.gray('  (use "gutt add <file>" to stage)\n'));

    for (const f of modifiedUnstaged) {
      console.log(
        chalk.yellow(`    M  ${f.path}`) +
        chalk.gray(`  (+${f.added} -${f.removed})`)
      );
    }
  }

  if (deletedUnstaged.length > 0) {

    console.log(chalk.bold.red('\n  Deleted tracked files:'));
    console.log(chalk.gray('  (use "gutt remove <file>" to stage deletion)\n'));

    for (const f of deletedUnstaged) {
      console.log(chalk.red(`    D  ${f}`));
    }
  }

  // ------------------------------------------------
  // 3. UNTRACKED FILES
  // ------------------------------------------------

  let allWorkingFiles = [];

  try {
    allWorkingFiles = await listAllFiles(repo.workingDir);
  } catch {}

  const trackedPaths = new Set([
    ...staged.map(e => e.path),
    ...committedFiles.keys(),
  ]);

  const untracked = allWorkingFiles.filter(f => {
    if (isIgnored(f, userPatterns)) return false;
    if (trackedPaths.has(f)) return false;
    return true;
  });

  if (untracked.length > 0) {

    const { collapsed, individuals } = collapseUntrackedDirs(untracked);

    if (collapsed.length > 0) {
      console.log(chalk.bold('\n  Untracked directories:'));
      console.log(chalk.gray('  (use "gutt add <path>" to track files inside)\n'));

      for (const dir of collapsed) {
        console.log(chalk.gray(`    ?  ${dir}`));
      }
    }

    if (individuals.length > 0) {
      console.log(chalk.bold('\n  Untracked files:'));
      console.log(chalk.gray('  (use "gutt add <file>" to track)\n'));

      for (const f of individuals) {
        console.log(chalk.gray(`    ?  ${f}`));
      }
    }
  }

  // ------------------------------------------------
  // CLEAN STATE MESSAGE
  // ------------------------------------------------

  const hasAnything =
    staged.length > 0 ||
    modifiedUnstaged.length > 0 ||
    deletedUnstaged.length > 0 ||
    untracked.length > 0;

  if (!hasAnything) {
    console.log(chalk.green('\n  ✔  Working tree clean. Nothing to commit.\n'));
  }

  // ------------------------------------------------
  // METRICS DISPLAY — read-only, never modified here
  // ------------------------------------------------

  const report = workflow.report();

  console.log(chalk.blue('  📊 Workflow Efficiency Report'));
  console.log(chalk.gray(`  Efficiency: ${report.efficiency}%`));
  console.log(chalk.gray(`  Total Events: ${report.totalEvents}`));
  console.log(chalk.gray(`  Useful: ${report.useful}`));
  console.log(chalk.gray(`  Redundant: ${report.redundant}`));
  console.log(chalk.gray(`  Insight: ${report.improvementClaim}`));
  console.log();

  console.log(chalk.blue('  📦 Storage Optimization Report'));
  console.log(chalk.gray(`  Storage Efficiency: ${report.storageEfficiency}%`));
  console.log(chalk.gray(`  New Blobs: ${report.blobNew}`));
  console.log(chalk.gray(`  Deduplicated Blobs: ${report.blobDedup}`));
  console.log(chalk.gray(`  Insight: ${report.storageOptimization}`));
  console.log();
}

/**
 * FULL SNAPSHOT LOADER
 */
async function buildFullCommittedTree(startHash, repo) {

  const fileMap = new Map();

  if (!startHash) return fileMap;

  const commit = await repo.commits.retrieve(startHash);

  if (!commit) return fileMap;

  for (const entry of (commit.files || [])) {
    fileMap.set(entry.path, { hash: entry.hash });
  }

  return fileMap;
}

/**
 * Collapse noisy untracked dirs
 */
function collapseUntrackedDirs(untracked) {

  const dirCounts = new Map();

  for (const f of untracked) {
    const parts = f.split('/');
    if (parts.length > 1) {
      const topDir = parts[0] + '/';
      dirCounts.set(topDir, (dirCounts.get(topDir) || 0) + 1);
    }
  }

  const collapsed = [];
  const individuals = [];
  const seen = new Set();

  for (const f of untracked) {
    const parts = f.split('/');
    const topDir = parts.length > 1 ? parts[0] + '/' : null;

    if (topDir && dirCounts.get(topDir) > 1) {
      if (!seen.has(topDir)) {
        seen.add(topDir);
        collapsed.push(topDir);
      }
    } else {
      individuals.push(f);
    }
  }

  return { collapsed, individuals };
}

module.exports = statusCommand;
