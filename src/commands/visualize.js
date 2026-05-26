'use strict';

const chalk         = require('chalk');
const { shortHash } = require('../utils/hashUtils');

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();
  const hrs  = Math.floor(diff / 3600000);
  if (hrs < 1)    return 'just now';
  if (hrs < 24)   return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * `gutt visualize`
 *
 * Renders an ASCII commit tree showing the full history
 * with branch labels, HEAD marker, timestamps, and file counts.
 */
async function visualizeCommand(repo) {
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    console.log(chalk.yellow('\n  No commits to visualize yet.\n'));
    return;
  }

  const history  = await repo.commits.getHistory(headHash);
  const head     = await repo.refs.readHead();
  const branches = await repo.refs.listBranches();

  // Build a map of commitHash → branch names pointing at it
  const branchMap = {};
  for (const b of branches) {
    const hash = await repo.refs.resolveBranch(b);
    if (hash) {
      branchMap[hash] = branchMap[hash] || [];
      branchMap[hash].push(b);
    }
  }

  console.log(chalk.bold.cyan('\n  COMMIT TREE'));
  console.log(chalk.gray('  ' + '─'.repeat(52)));

  for (let i = 0; i < history.length; i++) {
    const c        = history[i];
    const isLatest = i === 0;
    const isLast   = i === history.length - 1;

    const branchLabels = (branchMap[c.hash] || [])
      .map(b => chalk.cyan(`[${b}]`))
      .join(' ');

    const headMarker = isLatest && head.type === 'branch'
      ? chalk.bold.yellow('◉ HEAD →')
      : chalk.gray('○');

    const fCount = c.files?.length || 0;

    console.log(
      `  ${headMarker}  ` +
      chalk.bold(c.message) + '  ' +
      chalk.gray(shortHash(c.hash)) +
      (branchLabels ? '  ' + branchLabels : '')
    );
    console.log(
      chalk.gray(`  ${isLast ? ' ' : '│'}     ${formatRelativeTime(c.timeStamp)}  ·  ${fCount} file${fCount !== 1 ? 's' : ''}`)
    );

    if (!isLast) {
      console.log(chalk.gray('  │'));
    }
  }
  console.log();
}

module.exports = visualizeCommand;
