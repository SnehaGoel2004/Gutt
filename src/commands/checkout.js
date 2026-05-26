'use strict';

const chalk                        = require('chalk');
const CheckoutManager              = require('../core/CheckoutManager');
const { hasWorkingTreeChanges }    = require('../core/WorkingTreeGuard');
const { shortHash }                = require('../utils/hashUtils');

/**
 * `gutt checkout <branch-or-hash>`
 *
 * SAFETY GUARD:
 * Before switching, we check for uncommitted changes. If any exist,
 * the user is warned and the checkout is blocked. This prevents silent
 * data loss — the original motivation for Git's own safety check.
 *
 * The user can bypass with --force (use with awareness) or first:
 *   gutt stash         → save changes
 *   gutt commit        → commit changes
 */
async function checkoutCommand(target, { force = false } = {}, repo) {
  // ── Safety check ────────────────────────────────────────────────────────
  const state = await hasWorkingTreeChanges(repo);

  if (force && !state.clean) {
    // --force was explicitly passed with a dirty tree.
    // Show a prominent destructive-operation warning before proceeding.
    console.log(chalk.red.bold('\n  ⚠  DESTRUCTIVE OPERATION'));
    console.log(chalk.red('  Discarding uncommitted changes and staged work.'));
    if (state.staged.length > 0) {
      console.log(chalk.red(`  Staged files that will be lost: ${state.staged.join(', ')}`));
    }
    if (state.modified.length > 0) {
      console.log(chalk.red(`  Modified files that will be reverted: ${state.modified.join(', ')}`));
    }
    console.log(); // blank line before the checkout output
  }

  if (!force) {
    if (!state.clean) {
      console.log(chalk.yellow('\n  ⚠  Uncommitted changes detected — checkout blocked.\n'));

      if (state.staged.length > 0) {
        console.log(chalk.yellow('  Staged (not committed):'));
        state.staged.forEach(f => console.log(chalk.yellow(`    • ${f}`)));
      }
      if (state.modified.length > 0) {
        console.log(chalk.yellow('  Modified (not staged):'));
        state.modified.forEach(f => console.log(chalk.yellow(`    • ${f}`)));
      }

      console.log(chalk.cyan('\n  Options:'));
      console.log(chalk.gray('    gutt stash              — save changes temporarily'));
      console.log(chalk.gray('    gutt commit "message"   — commit your work'));
      console.log(chalk.gray(`    gutt checkout ${target} --force  — override (data may be lost)\n`));
      return;
    }
  } // end if (!force)

  const mgr = new CheckoutManager(repo.refs, repo.commits, repo.blobs, repo.workingDir);
  const isBranch = await repo.refs.branchExists(target);

  try {
    if (isBranch) {
      const result = await mgr.checkoutBranch(target);
      console.log(chalk.bold.green(`\n  ✔  Switched to branch "${result.name}"`));
      if (result.commitHash) {
        const stats = [`${result.filesRestored} file(s) restored`];
        if (result.filesRemoved > 0) stats.push(`${result.filesRemoved} removed`);
        console.log(chalk.gray(`     ${stats.join('  ·  ')}  (commit ${shortHash(result.commitHash)})`));
      } else {
        console.log(chalk.gray('     Branch exists but has no commits yet.'));
      }
      console.log();
    } else {
      const result = await mgr.checkoutCommit(target);
      console.log(chalk.yellow(`\n  ⚠  Detached HEAD at ${shortHash(result.commitHash)}\n`));
      console.log(chalk.white(
        '  You are viewing a historical commit.\n' +
        '  Your files have been restored to that point in time.\n' +
        '  Changes here will not belong to any branch.\n'
      ));
      console.log(chalk.cyan(
        '  To return to your latest work:\n' +
        '    gutt checkout main\n\n' +
        '  To create a new branch from this point:\n' +
        '    gutt branch <name>  then  gutt checkout <name>\n'
      ));
      console.log(chalk.gray(`  Restored ${result.filesRestored} file(s)\n`));
    }
  } catch (err) {
    console.log(chalk.red(`\n  ✗  ${err.message}\n`));
  }
}

module.exports = checkoutCommand;
