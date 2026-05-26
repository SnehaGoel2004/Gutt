'use strict';

const path  = require('path');
const fs    = require('fs').promises;
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

/**
 * gutt status
 *
 * FIXED FOR FULL-SNAPSHOT ARCHITECTURE
 *
 * Previous bug:
 * Status walked commit history assuming commits were deltas.
 *
 * Current Gutt architecture:
 * Every commit already contains the COMPLETE repository snapshot.
 *
 * Therefore:
 * - no history traversal is needed
 * - HEAD commit alone is authoritative
 * - deleted ghost files disappear correctly after clone/checkout
 */

async function statusCommand(repo) {

  const index =
    new IndexManager(repo.indexPath);

  const staged =
    await index.read();

  const headHash =
    await repo.refs.resolveHead();

  const userPatterns =
    await loadIgnorePatterns(repo.workingDir);

  const head =
    await repo.refs.readHead();

  // FULL SNAPSHOT — read ONLY HEAD commit
  const committedFiles =
    await buildFullCommittedTree(
      headHash,
      repo
    );

  // ------------------------------------------------
  // Header
  // ------------------------------------------------

  const branchLabel =
    head.type === 'branch'
      ? chalk.bold.cyan(
          `On branch: ${head.name}`
        )
      : chalk.yellow(
          `HEAD detached at ${shortHash(head.hash)}`
        );

  console.log(`\n${branchLabel}`);

  if (headHash) {

    const headCommit =
      await repo.commits.retrieve(headHash);

    console.log(
      chalk.gray(
        `Last commit: ${shortHash(headHash)}  "${headCommit?.message}"`
      )
    );

  } else {

    console.log(
      chalk.gray('No commits yet.')
    );
  }

  console.log(
    chalk.gray('─'.repeat(50))
  );

  // ------------------------------------------------
  // 1. STAGED FILES
  // ------------------------------------------------

  if (staged.length > 0) {

    console.log(
      chalk.bold.green(
        '\n  Changes staged for commit:'
      )
    );

    console.log(
      chalk.gray(
        '  (use "gutt unstage <file>" to unstage)\n'
      )
    );

    for (const entry of staged) {

      const committed =
        committedFiles.get(entry.path);

      // New file

      if (!committed) {

        const content =
          await repo.blobs.retrieve(entry.hash);

        const lines =
          content
            ? content.split('\n').length
            : 0;

        console.log(
          chalk.green(`    A  ${entry.path}`) +
          chalk.gray(`  (new file, ${lines} lines)`)
        );

        continue;
      }

      // Modified file

      if (committed.hash !== entry.hash) {

        const prevContent =
          await repo.blobs.retrieve(committed.hash);

        const currContent =
          await repo.blobs.retrieve(entry.hash);

        const {
          added,
          removed
        } = diffSummary(
          prevContent || '',
          currContent || ''
        );

        console.log(
          chalk.green(`    M  ${entry.path}`) +
          chalk.gray(`  (+${added} -${removed})`)
        );

        continue;
      }

      // Identical

      console.log(
        chalk.gray(`    =  ${entry.path}`) +
        chalk.gray('  (no changes)')
      );
    }
  }

  // ------------------------------------------------
  // 2. MODIFIED / DELETED FILES
  // ------------------------------------------------

  const modifiedUnstaged = [];
  const deletedUnstaged  = [];

  for (const [filePath, committed] of committedFiles) {

    // Skip staged files
    if (
      staged.some(s => s.path === filePath)
    ) {
      continue;
    }

    const absPath =
      path.join(
        repo.workingDir,
        filePath
      );

    try {

      const currentContent =
        await fs.readFile(absPath, {
          encoding: 'utf8'
        });

      const currentBuffer =
        await fs.readFile(absPath);

      const currentHash =
        hashBuffer(currentBuffer);

      if (currentHash !== committed.hash) {

        const prevContent =
          await repo.blobs.retrieve(
            committed.hash
          );

        const {
          added,
          removed
        } = diffSummary(
          prevContent || '',
          currentContent
        );

        modifiedUnstaged.push({
          path: filePath,
          added,
          removed
        });
      }

    } catch (err) {

      if (err.code === 'ENOENT') {
        deletedUnstaged.push(filePath);
      }
    }
  }

  // ------------------------------------------------
  // Modified files
  // ------------------------------------------------

  if (modifiedUnstaged.length > 0) {

    console.log(
      chalk.bold.yellow(
        '\n  Changes not staged for commit:'
      )
    );

    console.log(
      chalk.gray(
        '  (use "gutt add <file>" to stage)\n'
      )
    );

    for (const f of modifiedUnstaged) {

      console.log(
        chalk.yellow(`    M  ${f.path}`) +
        chalk.gray(`  (+${f.added} -${f.removed})`)
      );
    }
  }

  // ------------------------------------------------
  // Deleted files
  // ------------------------------------------------

  if (deletedUnstaged.length > 0) {

    console.log(
      chalk.bold.red(
        '\n  Deleted tracked files:'
      )
    );

    console.log(
      chalk.gray(
        '  (use "gutt remove <file>" to stage deletion)\n'
      )
    );

    for (const f of deletedUnstaged) {

      console.log(
        chalk.red(`    D  ${f}`)
      );
    }
  }

  // ------------------------------------------------
  // 3. UNTRACKED FILES
  // ------------------------------------------------

  let allWorkingFiles = [];

  try {

    allWorkingFiles =
      await listAllFiles(repo.workingDir);

  } catch {}

  const trackedPaths =
    new Set([
      ...staged.map(e => e.path),
      ...committedFiles.keys(),
    ]);

  const untracked =
    allWorkingFiles.filter(f => {

      if (isIgnored(f, userPatterns)) {
        return false;
      }

      if (trackedPaths.has(f)) {
        return false;
      }

      return true;
    });

  if (untracked.length > 0) {

    const {
      collapsed,
      individuals
    } = collapseUntrackedDirs(
      untracked,
      trackedPaths
    );

    if (collapsed.length > 0) {

      console.log(
        chalk.bold(
          '\n  Untracked directories:'
        )
      );

      console.log(
        chalk.gray(
          '  (use "gutt add <path>" to track files inside)\n'
        )
      );

      for (const dir of collapsed) {

        console.log(
          chalk.gray(`    ?  ${dir}`)
        );
      }
    }

    if (individuals.length > 0) {

      console.log(
        chalk.bold(
          '\n  Untracked files:'
        )
      );

      console.log(
        chalk.gray(
          '  (use "gutt add <file>" to track)\n'
        )
      );

      for (const f of individuals) {

        console.log(
          chalk.gray(`    ?  ${f}`)
        );
      }
    }

    const suggestions =
      suggestIgnoreEntries(untracked);

    if (suggestions.length > 0) {

      console.log(
        chalk.gray(
          '\n  Tip: add these to .guttignore to clean up status output:'
        )
      );

      for (const s of suggestions) {

        console.log(
          chalk.gray(`    ${s}`)
        );
      }
    }
  }

  // ------------------------------------------------
  // CLEAN STATE
  // ------------------------------------------------

  const hasAnything =
    staged.length ||
    modifiedUnstaged.length ||
    deletedUnstaged.length ||
    untracked.length;

  if (!hasAnything) {

    console.log(
      chalk.green(
        '\n  ✔  Working tree clean. Nothing to commit.\n'
      )
    );

  } else {

    console.log();
  }
}

/**
 * FULL SNAPSHOT LOADER
 *
 * Current Gutt commits already contain the entire file tree.
 * Therefore we read ONLY the HEAD commit.
 */

async function buildFullCommittedTree(
  startHash,
  repo
) {

  const fileMap =
    new Map();

  if (!startHash) {
    return fileMap;
  }

  const commit =
    await repo.commits.retrieve(startHash);

  if (!commit) {
    return fileMap;
  }

  for (const entry of (commit.files || [])) {

    fileMap.set(
      entry.path,
      {
        hash: entry.hash
      }
    );
  }

  return fileMap;
}

/**
 * Collapse noisy untracked dirs
 */

function collapseUntrackedDirs(
  untracked,
  tracked
) {

  const dirCounts =
    new Map();

  for (const f of untracked) {

    const parts =
      f.split('/');

    if (parts.length > 1) {

      const topDir =
        parts[0] + '/';

      dirCounts.set(
        topDir,
        (dirCounts.get(topDir) || 0) + 1
      );
    }
  }

  const collapsedDirs =
    new Set();

  const collapsed   = [];
  const individuals = [];

  for (const f of untracked) {

    const parts =
      f.split('/');

    const topDir =
      parts.length > 1
        ? parts[0] + '/'
        : null;

    if (
      topDir &&
      dirCounts.get(topDir) > 1
    ) {

      if (!collapsedDirs.has(topDir)) {

        collapsedDirs.add(topDir);
        collapsed.push(topDir);
      }

    } else {

      individuals.push(f);
    }
  }

  return {
    collapsed,
    individuals
  };
}

/**
 * Ignore suggestions
 */

function suggestIgnoreEntries(
  untrackedFiles
) {

  const suggestions =
    new Set();

  for (const f of untrackedFiles) {

    const base =
      path.basename(f);

    const ext =
      path.extname(f).toLowerCase();

    if (
      base === '.env' ||
      base.startsWith('.env.')
    ) {
      suggestions.add('.env');
    }

    if (ext === '.log') {
      suggestions.add('*.log');
    }

    if (f.startsWith('node_modules/')) {
      suggestions.add('node_modules');
    }

    if (
      f.startsWith('dist/') ||
      f.startsWith('build/')
    ) {
      suggestions.add(
        f.split('/')[0] + '/'
      );
    }

    if (base === '.DS_Store') {
      suggestions.add('.DS_Store');
    }

    if (ext === '.map') {
      suggestions.add('*.map');
    }

    if (
      base === 'package-lock.json' ||
      base === 'yarn.lock'
    ) {
      suggestions.add(base);
    }
  }

  return [...suggestions];
}

module.exports = statusCommand;