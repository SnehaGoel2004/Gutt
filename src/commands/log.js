// 'use strict';

// const chalk         = require('chalk');
// const { shortHash } = require('../utils/hashUtils');

// function formatRelativeTime(isoString) {
//   const diff = Date.now() - new Date(isoString).getTime();
//   const mins = Math.floor(diff / 60000);
//   if (mins < 1)  return 'just now';
//   if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;
//   const hrs = Math.floor(mins / 60);
//   if (hrs < 24)  return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;
//   const days = Math.floor(hrs / 24);
//   return `${days} day${days > 1 ? 's' : ''} ago`;
// }

// /**
//  * `gutt log`
//  *
//  * Renders commit history as a vertical tree graph.
//  *
//  * Each entry is exactly:
//  *   Line 1:  <time> · <hash> [<branch>] ◀ HEAD (if latest)
//  *   Line 2:  <message>   (sanitized — newlines stripped)
//  *   Line 3:  Touched N file(s)
//  *   Line 4:  │             (tree connector, omitted after last entry)
//  *
//  * The message is explicitly sanitized with sanitizeMessage() to prevent
//  * embedded newlines or carriage returns from breaking the tree rendering.
//  * This was the root cause of the "floating message" bug — a commit message
//  * containing \n would emit an extra line outside the structured block.
//  */
// async function logCommand(repo) {
//   const headHash = await repo.refs.resolveHead();
//   if (!headHash) {
//     console.log(chalk.yellow('\n  No commits yet.\n'));
//     return;
//   }

//   const history = await repo.commits.getHistory(headHash);
//   const head    = await repo.refs.readHead();

//   console.log(chalk.bold.cyan('\n  COMMIT HISTORY'));
//   console.log(chalk.gray('  ' + '─'.repeat(52)));

//   for (let i = 0; i < history.length; i++) {
//     const c      = history[i];
//     const isHead = i === 0;
//     const isLast = i === history.length - 1;
//     const when   = formatRelativeTime(c.timeStamp);
//     const fCount = c.files?.length || 0;

//     // Branch label — only show if this commit's recorded branch is set
//     const branchName = c.branch && c.branch !== 'detached' ? c.branch : null;
//     const branchTag  = branchName ? chalk.cyan(` [${branchName}]`) : '';
//     const headTag    = isHead ? chalk.bold.yellow(' ◀ HEAD') : '';

//     // Sanitize message: strip embedded newlines/carriage returns.
//     // A message like "fix\nmore stuff" would otherwise push "more stuff"
//     // onto its own line, breaking the tree connector alignment.
//     const message = sanitizeMessage(c.message);

//     // ── Render the block ─────────────────────────────────────────────────
//     console.log(
//       chalk.yellow(`\n  ${when}`) +
//       chalk.gray(` · ${shortHash(c.hash)}`) +
//       branchTag +
//       headTag
//     );
//     console.log(chalk.white(`  ${message}`));
//     console.log(chalk.gray(`  Touched ${fCount} file${fCount !== 1 ? 's' : ''}`));

//     // Tree connector between entries — not after the last one
//     if (!isLast) {
//       console.log(chalk.gray('  │'));
//     }
//   }

//   console.log(chalk.gray(`\n  Total: ${history.length} commit${history.length !== 1 ? 's' : ''}\n`));
// }

// /**
//  * Strips embedded newlines, carriage returns, and control characters
//  * from a commit message so it renders as a single line in the tree.
//  * Replaces any internal newline sequence with a space.
//  */
// function sanitizeMessage(msg) {
//   // Guard against non-string values — can occur if a commit message was
//   // accidentally stored as an object (e.g. during a transition/bug).
//   if (!msg) return '(no message)';
//   if (typeof msg !== 'string') return String(msg);
//   return msg
//     .replace(/\r\n/g, ' ')
//     .replace(/[\r\n]/g, ' ')
//     .replace(/\s{2,}/g, ' ')
//     .trim();
// }

// module.exports = logCommand;



'use strict';

const chalk = require('chalk');
const { shortHash } = require('../utils/hashUtils');

function formatRelativeTime(isoString) {
  const diff = Date.now() - new Date(isoString).getTime();

  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins > 1 ? 's' : ''} ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs > 1 ? 's' : ''} ago`;

  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function sanitizeMessage(msg) {
  if (!msg) return '(no message)';
  if (typeof msg !== 'string') return String(msg);

  return msg
    .replace(/\r\n/g, ' ')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * gutt log
 * gutt log --oneline
 */
async function logCommand(repo, options = {}) {
  const headHash = await repo.refs.resolveHead();

  if (!headHash) {
    console.log(chalk.yellow('\n  No commits yet.\n'));
    return;
  }

  const history = await repo.commits.getHistory(headHash);

  // =========================================
  // ONELINE MODE
  // =========================================
  if (options.oneline) {
    for (const commit of history) {
      const hash = shortHash(commit.hash);
      const msg = sanitizeMessage(commit.message);

      console.log(`${hash} ${msg}`);
    }

    console.log('');
    return;
  }

  // =========================================
  // NORMAL TREE MODE
  // =========================================

  console.log(chalk.bold.cyan('\n  COMMIT HISTORY'));
  console.log(chalk.gray('  ' + '─'.repeat(52)));

  for (let i = 0; i < history.length; i++) {
    const c = history[i];

    const isHead = i === 0;
    const isLast = i === history.length - 1;

    const when = formatRelativeTime(c.timeStamp);

    const branchName =
      c.branch && c.branch !== 'detached'
        ? c.branch
        : null;

    const branchTag = branchName
      ? chalk.cyan(` [${branchName}]`)
      : '';

    const headTag = isHead
      ? chalk.bold.yellow(' ◀ HEAD')
      : '';

    const fileCount = c.files?.length || 0;

    const message = sanitizeMessage(c.message);

    console.log(
      chalk.yellow(`\n  ${when}`) +
      chalk.gray(` · ${shortHash(c.hash)}`) +
      branchTag +
      headTag
    );

    console.log(chalk.white(`  ${message}`));

    console.log(
      chalk.gray(
        `  Touched ${fileCount} file${fileCount !== 1 ? 's' : ''}`
      )
    );

    if (!isLast) {
      console.log(chalk.gray('  │'));
    }
  }

  console.log(
    chalk.gray(
      `\n  Total: ${history.length} commit${history.length !== 1 ? 's' : ''}\n`
    )
  );
}

module.exports = logCommand;