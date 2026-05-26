'use strict';

const chalk          = require('chalk');
const { computeDiff, summarizeDiff, normalizeDiff } = require('../utils/diffUtils');
const { shortHash }  = require('../utils/hashUtils');

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * `gutt show <commitHash>`
 *
 * Displays a colored line-level diff for every file in a commit,
 * compared against its parent commit.
 *
 * Also shows which files are critical/sensitive.
 */
async function showCommand(commitHash, repo) {
  let commit, resolvedHash;
  try {
    ({ commit, hash: resolvedHash } = await repo.commits.retrieveByPrefix(commitHash));
  } catch (err) {
    console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    return;
  }

  const parentCommit = commit.parent ? await repo.commits.retrieve(commit.parent) : null;

  console.log(chalk.bold.cyan(`\n  COMMIT  ${shortHash(resolvedHash)}`));
  console.log(chalk.gray(`  Branch: ${commit.branch || 'unknown'}  ·  ${formatRelativeTime(commit.timeStamp)}`));
  console.log(chalk.bold.white(`  "${commit.message}"`));
  console.log(chalk.gray('  ' + '─'.repeat(52)));

  console.log(chalk.gray(`  Parent: ${commit.parent ? shortHash(commit.parent) : 'none (initial commit)'}`));
  console.log(chalk.gray(`  Files changed: ${(commit.files || []).length}`));

  for (const entry of commit.files || []) {
    // const currContent = await repo.blobs.retrieve(entry.hash);
    // const prevEntry   = parentCommit?.files?.find(f => f.path === entry.path);
    // const prevContent = prevEntry ? await repo.blobs.retrieve(prevEntry.hash) : null;
    const currRaw = await repo.blobs.retrieve(entry.hash);
    const prevEntry = parentCommit?.files?.find(f => f.path === entry.path);
    const prevRaw = prevEntry
      ? await repo.blobs.retrieve(prevEntry.hash)
      : null;
    const currContent = Buffer.isBuffer(currRaw)
      ? currRaw.toString('utf8')
      : String(currRaw || '');

    const prevContent = Buffer.isBuffer(prevRaw)
      ? prevRaw.toString('utf8')
      : (prevRaw === null ? null : String(prevRaw));

      if (!entry && prevEntry) {
        console.log(chalk.bold.red(`\n  - ${filePath}  (deleted)`));
        continue;
      }

      if (prevContent === null && !parentCommit) {
      // First commit — show file as fully added
      const lines = (currContent || '').split('\n');
      console.log(chalk.bold.green(`\n  + ${entry.path}  (new file)`));
      lines.forEach(line => process.stdout.write(chalk.green(`    + ${line}\n`)));
      continue;
    }

    if (prevContent === null) {
      console.log(chalk.bold.green(`\n  + ${entry.path}  (new file in this commit)`));
    } else {
      const { added, removed } = summarizeDiff(computeDiff(prevContent, currContent));
      console.log(
        chalk.bold.white(`\n  ~ ${entry.path}`) +
        chalk.gray(`  `) +
        chalk.green(`+${added}`) + ' ' + chalk.red(`-${removed}`)
      );
    }

    // Colored diff output
    // const diff = computeDiff(prevContent || '', currContent || '');
    // for (const part of diff) {
    //   const lines  = part.value.split('\n').filter((_, i, arr) => i < arr.length - 1 || part.value.endsWith('\n') || arr.length === 1);
    //   const prefix = part.added ? '+' : part.removed ? '-' : ' ';
    //   const color  = part.added ? chalk.green : part.removed ? chalk.red : chalk.gray;
    //   for (const line of part.value.split('\n')) {
    //     if (line || part.added || part.removed) {
    //       process.stdout.write(color(`    ${prefix} ${line}\n`));
    //     }
    //   }
    // }
    const rawDiff = computeDiff(prevContent || '', currContent || '');
    const diff = normalizeDiff(rawDiff);

    for (const change of diff) {
      if (change.type === 'added') {
        process.stdout.write(
          chalk.green(`    + ${change.value}\n`)
        );
      }
      
      else if (change.type === 'removed') {
        process.stdout.write(
          chalk.red(`    - ${change.value}\n`)
        );
      }
      
      else if (change.type === 'modified') {
        process.stdout.write(
          chalk.yellow(`    ~ ${change.oldValue} → ${change.newValue}\n`)
        );
      }
    }
  }
  console.log();
}

module.exports = showCommand;
