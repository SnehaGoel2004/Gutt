'use strict';

const chalk           = require('chalk');
const CheckoutManager = require('../core/CheckoutManager');
const { readFile, writeFile } = require('../utils/fileUtils');
const { shortHash }   = require('../utils/hashUtils');

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

async function readCheckpoints(repo) {
  const raw = await readFile(repo.checkpointsPath);
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}

async function writeCheckpoints(repo, checkpoints) {
  await writeFile(repo.checkpointsPath, JSON.stringify(checkpoints, null, 2));
}

/**
 * `gutt checkpoint [label]`     — create a snapshot
 * `gutt checkpoint --list`       — list checkpoints
 * `gutt checkpoint --restore <id>` — restore to a checkpoint
 *
 * Checkpoints are lighter than commits:
 * - No staging required
 * - Capture HEAD position and staging area state
 * - Can be restored to undo work-in-progress mistakes
 * - Perfect for "I'm about to try something risky" moments
 */
async function checkpointCommand(label, { list, restore } = {}, repo) {
  // ── LIST ─────────────────────────────────────────────────────────────────
  if (list) {
    const cps = await readCheckpoints(repo);
    if (cps.length === 0) {
      console.log(chalk.yellow('\n  No checkpoints yet. Create one: gutt checkpoint [label]\n'));
      return;
    }
    console.log(chalk.bold.cyan('\n  CHECKPOINTS'));
    console.log(chalk.gray('  ' + '─'.repeat(44)));
    for (const cp of cps) {
      console.log(
        chalk.bold(`\n  [${cp.id}]  ${cp.label}`) +
        chalk.gray(`  ·  ${formatRelativeTime(cp.timeStamp)}`)
      );
      console.log(chalk.gray(`         HEAD: ${shortHash(cp.headHash || '')}  ·  ${cp.stagedCount} file(s) staged`));
    }
    console.log();
    return;
  }

  // ── RESTORE ──────────────────────────────────────────────────────────────
  if (restore) {
    const cps = await readCheckpoints(repo);
    const target = cps.find(cp => cp.id === restore || cp.label === restore);
    if (!target) {
      console.log(chalk.red(`\n  ✗  Checkpoint "${restore}" not found.`));
      console.log(chalk.gray('     Run: gutt checkpoint --list\n'));
      return;
    }

    try {
      const mgr    = new CheckoutManager(repo.refs, repo.commits, repo.blobs, repo.workingDir);
      const result = await mgr.restoreCheckpoint(target);
      console.log(chalk.bold.green(`\n  ✔  Restored checkpoint "${target.label}"`));
      console.log(chalk.gray(`     ${result.filesRestored} file(s) restored from commit ${shortHash(target.headHash)}\n`));
    } catch (err) {
      console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    }
    return;
  }

  // ── CREATE ───────────────────────────────────────────────────────────────
  const cps      = await readCheckpoints(repo);
  const headHash = await repo.refs.resolveHead();
  const { readFile: rf } = require('../utils/fileUtils');
  const IndexManager = require('../core/IndexManager');
  const index    = new IndexManager(repo.indexPath);
  const staged   = await index.read();

  const cp = {
    id:          Date.now().toString(36),
    label:       label || `checkpoint-${cps.length + 1}`,
    timeStamp:   new Date().toISOString(),
    headHash:    headHash || null,
    stagedCount: staged.length,
  };

  cps.push(cp);
  await writeCheckpoints(repo, cps);

  console.log(chalk.bold.green(`\n  ✔  Checkpoint created: "${cp.label}"`));
  console.log(chalk.gray(`     ID: ${cp.id}  ·  HEAD: ${shortHash(cp.headHash || '')}`));
  console.log(chalk.gray(`     Restore later with: gutt checkpoint --restore ${cp.id}\n`));
}

module.exports = checkpointCommand;
