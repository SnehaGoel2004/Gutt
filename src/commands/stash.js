'use strict';

const path     = require('path');
const fs       = require('fs').promises;
const chalk    = require('chalk');
const IndexManager = require('../core/IndexManager');
const { readFile, writeFile, exists } = require('../utils/fileUtils');
const { hashBuffer, shortHash } = require('../utils/hashUtils');
const { loadIgnorePatterns, isIgnored } = require('../utils/ignoreUtils');
const { listAllFiles } = require('../utils/fileUtils');

/**
 * `gutt stash [label]`           — save uncommitted changes, restore clean state
 * `gutt stash list`               — list all saved stashes
 * `gutt stash apply [id]`         — reapply a stash (default: most recent)
 * `gutt stash drop [id]`          — delete a stash entry
 *
 * Storage: .gutt/stash/<id>.json
 *
 * A stash captures two things:
 *   1. The index state (what was staged)
 *   2. Working-directory modifications to tracked + staged files
 *
 * After stashing, the working directory is restored to the last committed
 * state, and the staging area is cleared.
 *
 * This is NOT a shallow copy. File content is stored as blobs using the
 * existing BlobStorage layer — content-addressed, deduplicated.
 */

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) > 1 ? 's' : ''} ago`;
}

async function getStashDir(repo) {
  const dir = path.join(repo.gutDir, 'stash');
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

async function loadAllStashes(repo) {
  const dir = await getStashDir(repo);
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch { return []; }

  const stashes = [];
  for (const f of entries.filter(e => e.endsWith('.json'))) {
    const raw = await readFile(path.join(dir, f));
    if (!raw) continue;
    try {
      stashes.push(JSON.parse(raw));
    } catch { /* corrupted stash entry — skip */ }
  }
  // Sort newest first
  stashes.sort((a, b) => new Date(b.timeStamp) - new Date(a.timeStamp));
  return stashes;
}

// ── stash (save) ─────────────────────────────────────────────────────────────

async function stashSave(label, repo) {
  const index    = new IndexManager(repo.indexPath);
  const staged   = await index.read();
  const headHash = await repo.refs.resolveHead();

  // Build full committed tree
  const committedFiles = new Map();
  let cur = headHash;
  while (cur) {
    const commit = await repo.commits.retrieve(cur);
    if (!commit) break;
    for (const f of (commit.files || [])) {
      if (!committedFiles.has(f.path)) committedFiles.set(f.path, f.hash);
    }
    cur = commit.parent || null;
  }

  // Collect ALL modified working-directory files (staged + unstaged modifications)
  const userPatterns   = await loadIgnorePatterns(repo.workingDir);
  const workingFiles   = await listAllFiles(repo.workingDir).catch(() => []);
  const snapshots      = [];

  // 1. Everything in staging area
  for (const entry of staged) {
    const absPath = path.join(repo.workingDir, entry.path);
    let buffer;
    try {
      buffer = await fs.readFile(absPath); // raw Buffer — binary-safe
    } catch { buffer = null; }

    if (buffer !== null) {
      const { hash } = await repo.blobs.storeBuffer(buffer);
      snapshots.push({ path: entry.path, hash, source: 'staged' });
    }
  }

  // 2. Tracked files modified in working dir but not staged
  for (const [filePath, committedHash] of committedFiles) {
    if (staged.some(s => s.path === filePath)) continue; // already captured above
    const absPath = path.join(repo.workingDir, filePath);
    try {
      // Read as Buffer for correct hash comparison with stored blobs
      const buffer      = await fs.readFile(absPath);
      const currentHash = hashBuffer(buffer);
      if (currentHash !== committedHash) {
        const { hash } = await repo.blobs.storeBuffer(buffer);
        snapshots.push({ path: filePath, hash, source: 'modified' });
      }
    } catch { /* deleted or unreadable — skip */ }
  }

  if (snapshots.length === 0) {
    console.log(chalk.yellow('\n  Nothing to stash — no modified or staged files.\n'));
    return;
  }

  // Persist the stash entry
  const id = Date.now().toString(36);
  const stashEntry = {
    id,
    label:      label || `stash@{${(await loadAllStashes(repo)).length}}`,
    timeStamp:  new Date().toISOString(),
    headHash,
    snapshots,
    stagedPaths: staged.map(s => s.path),
  };

  const stashDir  = await getStashDir(repo);
  await writeFile(path.join(stashDir, `${id}.json`), JSON.stringify(stashEntry, null, 2));

  // Restore working directory to clean committed state
  await restoreToCommitted(committedFiles, repo);

  // Clear staging area
  await index.clear();

  const stagedCount   = snapshots.filter(s => s.source === 'staged').length;
  const modifiedCount = snapshots.filter(s => s.source === 'modified').length;

  console.log(chalk.bold.green(`\n  ✔  Stash saved: "${stashEntry.label}"`));
  if (stagedCount > 0)   console.log(chalk.gray(`     ${stagedCount} staged file(s) stashed`));
  if (modifiedCount > 0) console.log(chalk.gray(`     ${modifiedCount} modified file(s) stashed`));
  console.log(chalk.gray(`     ID: ${id}  ·  Restore with: gutt stash apply ${id}\n`));
}

// ── stash list ───────────────────────────────────────────────────────────────

async function stashList(repo) {
  const stashes = await loadAllStashes(repo);

  if (stashes.length === 0) {
    console.log(chalk.yellow('\n  No stashes saved.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n  STASH LIST'));
  console.log(chalk.gray('  ' + '─'.repeat(44)));

  stashes.forEach((s, i) => {
    const stagedCount   = s.snapshots.filter(f => f.source === 'staged').length;
    const modifiedCount = s.snapshots.filter(f => f.source === 'modified').length;
    const parts = [];
    if (stagedCount > 0)   parts.push(`${stagedCount} staged`);
    if (modifiedCount > 0) parts.push(`${modifiedCount} modified`);
    const summary = parts.join(', ') || `${s.snapshots.length} files`;

    console.log(chalk.bold(`\n  [${i + 1}] ${s.label}`) + chalk.gray(`  ·  ID: ${s.id}`));
    console.log(chalk.gray(`       ${summary}  ·  saved ${formatRelativeTime(s.timeStamp)}`));
    if (s.headHash) {
      console.log(chalk.gray(`       at commit ${shortHash(s.headHash)}`));
    }
  });
  console.log();
}

// ── stash apply ──────────────────────────────────────────────────────────────

async function stashApply(idOrIndex, repo) {
  const stashes = await loadAllStashes(repo);

  if (stashes.length === 0) {
    console.log(chalk.yellow('\n  No stashes to apply.\n'));
    return;
  }

  let target;
  if (!idOrIndex) {
    target = stashes[0]; // most recent
  } else {
    // Accept numeric index (1-based) or full ID string
    const n = parseInt(idOrIndex, 10);
    if (!isNaN(n) && n >= 1 && n <= stashes.length) {
      target = stashes[n - 1];
    } else {
      target = stashes.find(s => s.id === idOrIndex);
    }
  }

  if (!target) {
    console.log(chalk.red(`\n  ✗  Stash not found: "${idOrIndex}"\n`));
    console.log(chalk.gray('     Run: gutt stash list\n'));
    return;
  }

  // Write each stashed file back to the working directory
  let restored = 0;
  for (const snap of target.snapshots) {
    const buffer = await repo.blobs.retrieveBuffer(snap.hash);
    if (!buffer) {
      console.log(chalk.yellow(`  ⚠  Blob missing for ${snap.path} — skipping`));
      continue;
    }
    const targetPath = path.join(repo.workingDir, snap.path);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
    restored++;
  }

  // Re-stage files that were staged when stash was created
  const index = new IndexManager(repo.indexPath);
  for (const snap of target.snapshots.filter(s => s.source === 'staged')) {
    await index.stage(snap.path, snap.hash);
  }

  console.log(chalk.bold.green(`\n  ✔  Applied stash: "${target.label}"`));
  console.log(chalk.gray(`     ${restored} file(s) restored`));
  if (target.stagedPaths?.length > 0) {
    console.log(chalk.gray(`     Re-staged: ${target.stagedPaths.join(', ')}`));
  }
  console.log(chalk.gray(`\n  Tip: the stash is still saved. Use: gutt stash drop ${target.id}\n`));
}

// ── stash drop ───────────────────────────────────────────────────────────────

async function stashDrop(idOrIndex, repo) {
  const stashes = await loadAllStashes(repo);

  let target;
  const n = parseInt(idOrIndex, 10);
  if (!isNaN(n) && n >= 1 && n <= stashes.length) {
    target = stashes[n - 1];
  } else {
    target = stashes.find(s => s.id === idOrIndex);
  }

  if (!target) {
    console.log(chalk.red(`\n  ✗  Stash not found: "${idOrIndex}"\n`));
    return;
  }

  const stashDir  = await getStashDir(repo);
  const stashFile = path.join(stashDir, `${target.id}.json`);
  try {
    await fs.unlink(stashFile);
    console.log(chalk.green(`\n  ✔  Dropped stash: "${target.label}"\n`));
  } catch {
    console.log(chalk.red(`\n  ✗  Could not delete stash file.\n`));
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Restores the working directory to match the committed state exactly.
 * Files not in the committed tree are left untouched (only tracked files revert).
 */
async function restoreToCommitted(committedFiles, repo) {
  for (const [filePath, blobHash] of committedFiles) {
    const buffer = await repo.blobs.retrieveBuffer(blobHash);
    if (!buffer) continue;
    const targetPath = path.join(repo.workingDir, filePath);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, buffer);
  }
}

// ── router ───────────────────────────────────────────────────────────────────

async function stashCommand(subcommand, args, repo) {
  switch (subcommand) {
    case 'list':
      return stashList(repo);
    case 'apply':
      return stashApply(args[0], repo);
    case 'drop':
      return stashDrop(args[0], repo);
    default:
      // subcommand is actually the label (or undefined)
      return stashSave(subcommand, repo);
  }
}

module.exports = stashCommand;
