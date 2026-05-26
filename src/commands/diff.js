'use strict';

const path  = require('path');
const fs    = require('fs').promises;
const chalk = require('chalk');
const { computeDiff } = require('../utils/diffUtils');
const { hashBuffer }  = require('../utils/hashUtils');
const IndexManager    = require('../core/IndexManager');

/**
 * `gutt diff`                — unstaged changes (working tree vs HEAD)
 * `gutt diff --staged`       — staged changes (index vs HEAD)
 * `gutt diff <hash> <hash>`  — diff between two commits
 *
 * Output is Git-style colored unified diff:
 *   + added line
 *   - removed line
 *     context line
 *
 * Architecture note: diff is a read-only operation that uses the same
 * blob retrieval path as status — no new storage layer needed.
 */
async function diffCommand(repo, { staged = false, commitA, commitB } = {}) {

  // ── Mode 3: commit-to-commit diff ────────────────────────────────────────
  if (commitA && commitB) {
    await diffCommits(commitA, commitB, repo);
    return;
  }

  const headHash   = await repo.refs.resolveHead();
  const index      = new IndexManager(repo.indexPath);
  const stagedList = await index.read();

  // Build the full committed tree
  const committedTree = new Map();
  let cur = headHash;
  while (cur) {
    const commit = await repo.commits.retrieve(cur);
    if (!commit) break;
    for (const f of (commit.files || [])) {
      if (!committedTree.has(f.path)) committedTree.set(f.path, f.hash);
    }
    cur = commit.parent || null;
  }

  if (staged) {
    // ── Mode 2: staged diff (index vs HEAD) ────────────────────────────────
    if (stagedList.length === 0) {
      console.log(chalk.gray('\n  No staged changes.\n'));
      return;
    }

    let anyOutput = false;
    for (const entry of stagedList) {
      const committedHash = committedTree.get(entry.path);
      const oldContent    = committedHash ? await repo.blobs.retrieve(committedHash) : '';
      const newContent    = await repo.blobs.retrieve(entry.hash);
      if (oldContent === newContent) continue;
      printFileDiff(entry.path, oldContent || '', newContent || '', '(staged)');
      anyOutput = true;
    }
    if (!anyOutput) console.log(chalk.gray('\n  No differences in staged files.\n'));

  } else {
    // ── Mode 1: unstaged diff (working tree vs HEAD) ──────────────────────
    let anyOutput = false;

    for (const [filePath, committedHash] of committedTree) {
      // Skip if staged — staged files are shown with --staged
      if (stagedList.some(s => s.path === filePath)) continue;

      const absPath = path.join(repo.workingDir, filePath);
      let currentContent;
      try {
        const buf    = await fs.readFile(absPath);
        currentContent = buf.toString('utf-8');
        const currentHash = hashBuffer(buf);
        if (currentHash === committedHash) continue; // unchanged
      } catch (err) {
        if (err.code !== 'ENOENT') throw err;
        continue; // deleted files shown in status, not diff
      }

      const committedContent = await repo.blobs.retrieve(committedHash);
      printFileDiff(filePath, committedContent || '', currentContent, '(working tree)');
      anyOutput = true;
    }

    if (!anyOutput) console.log(chalk.gray('\n  No unstaged changes. Use --staged to see staged diff.\n'));
  }
}

async function diffCommits(hashA, hashB, repo) {
  let resolvedA, resolvedB, commitA, commitB;
  try {
    ({ hash: resolvedA, commit: commitA } = await repo.commits.retrieveByPrefix(hashA));
    ({ hash: resolvedB, commit: commitB } = await repo.commits.retrieveByPrefix(hashB));
  } catch (err) {
    console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    return;
  }

  // Build full trees for both commits
  const treeA = await buildTree(resolvedA, repo);
  const treeB = await buildTree(resolvedB, repo);

  const allPaths = new Set([...treeA.keys(), ...treeB.keys()]);
  let anyOutput  = false;

  for (const filePath of [...allPaths].sort()) {
    const hashA_ = treeA.get(filePath);
    const hashB_ = treeB.get(filePath);
    if (hashA_ === hashB_) continue;

    const oldContent = hashA_ ? await repo.blobs.retrieve(hashA_) : '';
    const newContent = hashB_ ? await repo.blobs.retrieve(hashB_) : '';
    printFileDiff(filePath, oldContent || '', newContent || '');
    anyOutput = true;
  }

  if (!anyOutput) console.log(chalk.gray('\n  No differences between these commits.\n'));
}

async function buildTree(startHash, repo) {
  const tree = new Map();
  let cur    = startHash;
  while (cur) {
    const commit = await repo.commits.retrieve(cur);
    if (!commit) break;
    for (const f of (commit.files || [])) {
      if (!tree.has(f.path)) tree.set(f.path, f.hash);
    }
    cur = commit.parent || null;
  }
  return tree;
}

/**
 * Renders a unified-style colored diff for one file.
 * Context lines (unchanged) are shown in gray, additions in green, removals in red.
 * This matches the visual convention of `git diff`.
 */
function printFileDiff(filePath, oldContent, newContent, label = '') {
  const diff = computeDiff(oldContent, newContent);

  // Skip if no actual changes
  const hasChanges = diff.some(p => p.added || p.removed);
  if (!hasChanges) return;

  const labelStr = label ? chalk.gray(`  ${label}`) : '';
  console.log(chalk.bold(`\n  diff  ${filePath}`) + labelStr);
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  for (const part of diff) {
    const lines = part.value.split('\n');
    // The diff library includes a trailing empty string from split — remove it
    if (lines[lines.length - 1] === '') lines.pop();

    for (const line of lines) {
      if (part.added) {
        console.log(chalk.green(`  + ${line}`));
      } else if (part.removed) {
        console.log(chalk.red(`  - ${line}`));
      } else {
        console.log(chalk.gray(`    ${line}`));
      }
    }
  }
}

module.exports = diffCommand;
