'use strict';

const chalk          = require('chalk');
const BranchManager  = require('../core/BranchManager');
const { shortHash }  = require('../utils/hashUtils');

/**
 * `gutt branch`              — list all branches
 * `gutt branch <name>`       — create a new branch
 * `gutt branch -d <name>`    — delete a branch
 */
async function branchCommand(name, { delete: del } = {}, repo) {
  const mgr = new BranchManager(repo.refs);

  // ── DELETE ───────────────────────────────────────────────────────────────
  if (del) {
    try {
      await mgr.delete(name);
      console.log(chalk.green(`\n  ✔  Deleted branch "${name}"\n`));
    } catch (err) {
      console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    }
    return;
  }

  // ── CREATE ───────────────────────────────────────────────────────────────
  if (name) {
    try {
      const result = await mgr.create(name);
      console.log(chalk.green(`\n  ✔  Created branch "${result.branchName}"`));
      console.log(chalk.gray(`     Points to commit: ${shortHash(result.commitHash)}\n`));
    } catch (err) {
      console.log(chalk.red(`\n  ✗  ${err.message}\n`));
    }
    return;
  }

  // ── LIST ─────────────────────────────────────────────────────────────────
  const branches = await mgr.list();

  if (branches.length === 0) {
    console.log(chalk.yellow('\n  No branches yet. Commit something first.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n  BRANCHES\n'));

  for (const b of branches) {
    const hash = await repo.refs.resolveBranch(b.name);
    const marker = b.isCurrent ? chalk.bold.green('  * ') : chalk.gray('    ');
    const label  = b.isCurrent ? chalk.bold.green(b.name) : chalk.white(b.name);
    console.log(marker + label + chalk.gray(`  ${shortHash(hash)}`));
  }

  console.log();
}

module.exports = branchCommand;
