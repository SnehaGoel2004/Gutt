'use strict';

const fs = require('fs').promises;
const path = require('path');
const chalk = require('chalk');

const IndexManager = require('../core/IndexManager');
const WorkflowMetrics = require('../utils/workflowMetrics');

const {
  loadIgnorePatterns,
  isIgnored,
  isSensitive
} = require('../utils/ignoreUtils');

const {
  listAllFiles
} = require('../utils/fileUtils');

async function expandFiles(inputs, repoRoot) {
  const ignorePatterns = await loadIgnorePatterns(repoRoot);
  const expanded = [];

  for (const input of inputs) {
    if (input === '.') {
      const allFiles = await listAllFiles(repoRoot);
      for (const file of allFiles) {
        const normalized = file.replace(/\\/g, '/');
        if (isIgnored(normalized, ignorePatterns)) continue;
        expanded.push(normalized);
      }
      continue;
    }

    const normalized = input.replace(/\\/g, '/');
    if (isIgnored(normalized, ignorePatterns)) {
      console.log(chalk.gray(`  ⊘  Ignored: ${normalized}  (matches .guttignore or built-in rules)`));
      continue;
    }
    expanded.push(normalized);
  }

  return expanded;
}

async function addCommand(fileInputs, repo) {

  const inputs = Array.isArray(fileInputs) ? fileInputs : [fileInputs];
  const files = await expandFiles(inputs, repo.workingDir);

  if (files.length === 0) {
    console.log(chalk.yellow('  Nothing to stage.'));
    return;
  }

  const index = new IndexManager(repo.indexPath);
  const current = await index.read();

  // SINGLE workflow instance for entire command — prevents overwrite race
  const workflow = new WorkflowMetrics(repo.rootPath || repo.workingDir);

  const headHash = await repo.refs.resolveHead();
  const headCommit = headHash ? await repo.commits.retrieve(headHash) : null;
  const committedFiles = new Map();
  for (const entry of (headCommit?.files || [])) {
    committedFiles.set(entry.path, entry.hash);
  }

  for (const filePath of files) {

    if (isSensitive(filePath)) {
      console.log(chalk.yellow.bold(`\n  ⚠️  Safety Warning: "${filePath}" looks like a sensitive file.`));
      console.log(chalk.yellow(`     Consider adding it to .guttignore\n`));
    }

    let buffer;

    try {
      buffer = await fs.readFile(repo.resolvePath(filePath));
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(chalk.red(`  ✗  File not found: ${filePath}`));
      } else {
        console.log(chalk.red(`  ✗  Cannot read "${filePath}": ${err.message}`));
      }
      continue;
    }

    const { hash, stored } = await repo.blobs.storeBuffer(buffer);

    const existing = current.find(e => e.path === filePath);

    // Already staged with same hash → redundant
    if (existing && existing.hash === hash) {
      workflow.data.events++;
      workflow.data.redundant++;
      workflow.data.blob_dedup++;
      workflow.save();

      console.log(chalk.gray(`  ⏭  Already staged (unchanged): ${filePath}`));
      continue;
    }

    await index.stage(filePath, hash);

    // Track blob storage result using the stored flag
    if (stored) {
      workflow.data.blob_new++;
    } else {
      workflow.data.blob_dedup++;
    }

    // Track staging intent
    if (!committedFiles.has(filePath)) {
      workflow.data.useful++;
      workflow.data.events++;
    } else if (committedFiles.get(filePath) !== hash) {
      workflow.data.useful++;
      workflow.data.events++;
    } else {
      workflow.data.redundant++;
      workflow.data.events++;
    }

    workflow.save();

    const dedupMessage = stored ? '' : chalk.gray('  (blob already in store — deduplicated)');
    console.log(chalk.green(`  ✔  Staged: ${filePath}`) + dedupMessage);
  }
}

module.exports = addCommand;
