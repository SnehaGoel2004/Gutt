// 'use strict';

// const fs       = require('fs').promises;
// const chalk    = require('chalk');
// const IndexManager  = require('../core/IndexManager');
// const { loadIgnorePatterns, isIgnored, isSensitive } = require('../utils/ignoreUtils');
// const { hashBuffer } = require('../utils/hashUtils');

// /**
//  * `gutt add <file>`
//  *
//  * THE ENCODING FIX — WHY WE READ AS BUFFER:
//  * Previous version: fs.readFile(path, { encoding: 'utf-8' })
//  * This converts raw bytes to a JavaScript string. For UTF-8 files this
//  * seems fine, but it is lossy for any file with non-UTF-8 bytes (images,
//  * binaries, BOMs) and causes the ï¿½ï¿½ corruption on checkout.
//  *
//  * Correct approach: fs.readFile(path) — returns a Buffer of raw bytes.
//  * The buffer is passed directly to BlobStorage.storeBuffer(), which
//  * hashes the raw bytes and writes them verbatim to disk.
//  *
//  * This is exactly how Git stores blobs: as zlib-compressed raw bytes
//  * with no encoding transformation.
//  */
// async function addCommand(filePath, repo) {
//   const userPatterns = await loadIgnorePatterns(repo.workingDir);

//   if (isIgnored(filePath, userPatterns)) {
//     console.log(chalk.gray(`  ⊘  Ignored: ${filePath}  (matches .guttignore or built-in rules)`));
//     return;
//   }

//   if (isSensitive(filePath)) {
//     console.log(chalk.yellow.bold(`\n  ⚠️  Safety Warning: "${filePath}" looks like a sensitive file.`));
//     console.log(chalk.yellow(`     Consider adding it to .guttignore\n`));
//   }

//   // Read as raw Buffer — no encoding conversion, preserves exact bytes
//   let buffer;
//   try {
//     buffer = await fs.readFile(repo.resolvePath(filePath)); // no encoding option = Buffer
//   } catch (err) {
//     if (err.code === 'ENOENT') {
//       console.log(chalk.red(`  ✗  File not found: ${filePath}`));
//     } else {
//       console.log(chalk.red(`  ✗  Cannot read "${filePath}": ${err.message}`));
//     }
//     return;
//   }

//   // Store the raw buffer — hash is computed on bytes, not string
//   const { hash, stored } = await repo.blobs.storeBuffer(buffer);

//   const index    = new IndexManager(repo.indexPath);
//   const current  = await index.read();
//   const existing = current.find(e => e.path === filePath);

//   if (existing && existing.hash === hash) {
//     console.log(chalk.gray(`  ⏭  Already staged (unchanged): ${filePath}`));
//     return;
//   }

//   await index.stage(filePath, hash);

//   const dedup = stored ? '' : chalk.gray('  (blob already in store — deduplicated)');
//   console.log(chalk.green(`  ✔  Staged: ${filePath}`) + dedup);
// }

// module.exports = addCommand;




'use strict';

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

const IndexManager = require('../core/IndexManager');

const {
  loadIgnorePatterns,
  isIgnored,
  isSensitive
} = require('../utils/ignoreUtils');

const {
  listAllFiles
} = require('../utils/fileUtils');

/**
 * Expands:
 *   gutt add .
 * into all valid repository files recursively.
 */
async function expandFiles(inputs, repoRoot) {
  const ignorePatterns = await loadIgnorePatterns(repoRoot);

  const expanded = [];

  for (const input of inputs) {

    // Recursive add
    if (input === '.') {
      const allFiles = await listAllFiles(repoRoot);

      for (const file of allFiles) {
        const normalized = file.replace(/\\/g, '/');

        if (isIgnored(normalized, ignorePatterns)) {
          continue;
        }

        expanded.push(normalized);
      }

      continue;
    }

    const normalized = input.replace(/\\/g, '/');

    if (isIgnored(normalized, ignorePatterns)) {
      console.log(
        chalk.gray(
          `  ⊘  Ignored: ${normalized}  (matches .guttignore or built-in rules)`
        )
      );
      continue;
    }

    expanded.push(normalized);
  }

  return expanded;
}

/**
 * Main add command.
 */
async function addCommand(fileInputs, repo) {

  // Support:
  // gutt add file.js
  // gutt add a.js b.js
  // gutt add .
  const inputs = Array.isArray(fileInputs)
    ? fileInputs
    : [fileInputs];

  const files = await expandFiles(inputs, repo.workingDir);

  if (files.length === 0) {
    console.log(chalk.yellow('  Nothing to stage.'));
    return;
  }

  const index = new IndexManager(repo.indexPath);
  const current = await index.read();

  for (const filePath of files) {

    if (isSensitive(filePath)) {
      console.log(
        chalk.yellow.bold(
          `\n  ⚠️  Safety Warning: "${filePath}" looks like a sensitive file.`
        )
      );

      console.log(
        chalk.yellow(
          `     Consider adding it to .guttignore\n`
        )
      );
    }

    let buffer;

    try {
      // IMPORTANT:
      // Read raw bytes, never UTF-8 text.
      buffer = await fs.readFile(
        repo.resolvePath(filePath)
      );

    } catch (err) {

      if (err.code === 'ENOENT') {
        console.log(
          chalk.red(`  ✗  File not found: ${filePath}`)
        );
      } else {
        console.log(
          chalk.red(
            `  ✗  Cannot read "${filePath}": ${err.message}`
          )
        );
      }

      continue;
    }

    // Store raw bytes safely
    const { hash, stored } =
      await repo.blobs.storeBuffer(buffer);

    const existing =
      current.find(e => e.path === filePath);

    // Already staged with same hash
    if (existing && existing.hash === hash) {

      console.log(
        chalk.gray(
          `  ⏭  Already staged (unchanged): ${filePath}`
        )
      );

      continue;
    }

    await index.stage(filePath, hash);

    const dedupMessage = stored
      ? ''
      : chalk.gray(
          '  (blob already in store — deduplicated)'
        );

    console.log(
      chalk.green(`  ✔  Staged: ${filePath}`) +
      dedupMessage
    );
  }
}

module.exports = addCommand;