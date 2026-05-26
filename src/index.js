#!/usr/bin/env node
'use strict';

/**
 * src/index.js — Gutt CLI entry point
 *
 * This file does ONE thing: map CLI commands to command functions.
 * No business logic lives here. Every command is imported from src/commands/.
 *
 * Pattern:
 *   1. Parse CLI args via Commander
 *   2. Construct a Repository instance (shared context)
 *   3. Verify the repo is initialized (where required)
 *   4. Delegate to the command function
 */

const { Command } = require('commander');
const chalk       = require('chalk');
const Repository  = require('./core/Repository');

// ── Command imports ──────────────────────────────────────────────────────────
const addCommand        = require('./commands/add');
const commitCommand     = require('./commands/commit');
const statusCommand     = require('./commands/status');
const logCommand        = require('./commands/log');
const branchCommand     = require('./commands/branch');
const checkoutCommand   = require('./commands/checkout');
const showCommand       = require('./commands/show');
const insightsCommand   = require('./commands/insights');
const hotspotsCommand   = require('./commands/hotspots');
const doctorCommand     = require('./commands/doctor');
const checkpointCommand = require('./commands/checkpoint');
const visualizeCommand  = require('./commands/visualize');
const churnCommand      = require('./commands/churn');
const stashCommand      = require('./commands/stash');
const diffCommand       = require('./commands/diff');
const timelineCommand   = require('./commands/timeline');
const restoreCommand    = require('./commands/restore');
const mergeCommand      = require('./commands/merge');
const CloneManager       = require('./remote/CloneManager');
const RemoteManager      = require('./remote/RemoteManager');
const program = new Command();

program
  .name('gutt')
  .description(
    chalk.bold.cyan('GUTT') + ' v2.0 — Developer-friendly Git-inspired VCS\n' +
    chalk.gray('  Smarter commits · Real-time visualization · Intelligent version tracking')
  )
  .version('2.0.0');

// ── Helper: build repo and guard initialization ──────────────────────────────

async function getRepo({ requireInit = true } = {}) {
  const repo = new Repository(process.cwd());
  if (requireInit && !await repo.isInitialized()) {
    console.log(chalk.red('\n  ✗  No Gutt repository found in this directory.'));
    console.log(chalk.gray('     Run: gutt init\n'));
    process.exit(1);
  }
  return repo;
}

// ── Commands ─────────────────────────────────────────────────────────────────

program
  .command('init')
  .description('Initialize a new Gutt repository in the current directory')
  .action(async () => {
    const repo = new Repository(process.cwd());
    await repo.initialize();
    console.log(chalk.bold.green('\n  ✔  Initialized empty Gutt repository (.gutt/)'));
    console.log(chalk.gray('     Branch: main  ·  Ready for: gutt add <file>\n'));
  });

program
  .command('add <file>')
  .description('Stage a file for the next commit')
  .action(async (file) => {
    const repo = await getRepo();
    await addCommand(file, repo);
  });

program
  .command('unstage <file>')
  .description('Remove a file from the staging area')
  .action(async (file) => {
    const repo  = await getRepo();
    const index = require('./core/IndexManager');
    const mgr   = new index(repo.indexPath);
    const ok    = await mgr.unstage(file);
    if (ok) console.log(chalk.green(`\n  ✔  Unstaged: ${file}\n`));
    else    console.log(chalk.yellow(`\n  "${file}" was not staged.\n`));
  });

program
  .command('remove <file>')
  .description('Delete a file from disk and remove from staging')
  .action(async (file) => {
    const repo = await getRepo();
    const fs   = require('fs').promises;
    try {
      await fs.unlink(repo.resolvePath(file));
      console.log(chalk.green(`  Deleted: ${file}`));
    } catch {
      console.log(chalk.gray(`  File not found on disk: ${file}`));
    }
    const index = require('./core/IndexManager');
    await new index(repo.indexPath).unstage(file);
    console.log(chalk.green(`  Removed from staging: ${file}\n`));
  });

program
  .command('status')
  .description('Show working tree status — staged, modified, deleted, untracked')
  .action(async () => {
    const repo = await getRepo();
    await statusCommand(repo);
  });

program
  .command('commit [message]')
  .description('Commit staged changes (omit message to auto-suggest)')
  .option('-s, --suggest', 'Show smart message suggestion alongside your own')
  .action(async (message, opts) => {
    const repo = await getRepo();
    await commitCommand(message, { suggest: opts.suggest }, repo);
  });

// program
//   .command('log')
//   .description('Show commit history in human-readable format')
//   .action(async () => {
//     const repo = await getRepo();
//     await logCommand(repo);
//   });

program
  .command('log')
  .description('Show commit history')
  .option('--oneline', 'Compact one-line history')
  .action(async (options) => {
    const repo = await getRepo();
    await logCommand(repo, options);
  });

program
  .command('show <commitHash>')
  .description('Show diff for a specific commit')
  .action(async (hash) => {
    const repo = await getRepo();
    await showCommand(hash, repo);
  });

program
  .command('branch [name]')
  .description('List branches, or create a new branch')
  .option('-d, --delete <name>', 'Delete a branch')
  .action(async (name, opts) => {
    const repo = await getRepo();
    const del  = opts.delete;
    await branchCommand(del || name, { delete: !!del }, repo);
  });

program
  .command('checkout <target>')
  .description('Switch to a branch or restore a historical commit')
  .option('-f, --force', 'Override dirty-tree check (unsafe — changes may be lost)')
  .action(async (target, opts) => {
    const repo = await getRepo();
    await checkoutCommand(target, { force: opts.force || false }, repo);
  });

program
  .command('visualize')
  .description('Visual commit tree with branch labels and timeline')
  .action(async () => {
    const repo = await getRepo();
    await visualizeCommand(repo);
  });

program
  .command('insights')
  .description('Repository analytics — active files, days, commit velocity')
  .action(async () => {
    const repo = await getRepo();
    await insightsCommand(repo);
  });

program
  .command('hotspots')
  .description('File change heatmap — shows high-churn files weighted by recency')
  .action(async () => {
    const repo = await getRepo();
    await hotspotsCommand(repo);
  });

program
  .command('doctor')
  .description('Repository health check — finds issues proactively')
  .action(async () => {
    const repo = await getRepo();
    await doctorCommand(repo);
  });

program
  .command('checkpoint [label]')
  .description('Create a lightweight recovery snapshot')
  .option('-l, --list',           'List all checkpoints')
  .option('-r, --restore <id>',   'Restore to a checkpoint by ID or label')
  .action(async (label, opts) => {
    const repo = await getRepo();
    await checkpointCommand(label, { list: opts.list, restore: opts.restore }, repo);
  });

program
  .command('churn')
  .description('File churn analysis — identifies high-risk, frequently modified files')
  .option('-d, --days <n>',  'Recency window in days (default: 14)', parseInt)
  .option('-m, --min <n>',   'Minimum commits to report (default: 3)', parseInt)
  .action(async (opts) => {
    const repo = await getRepo();
    await churnCommand(repo, { days: opts.days || 14, min: opts.min || 3 });
  });

program
  .command('timeline')
  .description('Development timeline — hourly/daily activity, streaks, weekly distribution')
  .action(async () => {
    const repo = await getRepo();
    await timelineCommand(repo);
  });

program
  .command('restore <commit-id>')
  .description('Safely restore files from a historical commit without switching branches')
  .addHelpText('after', `
  Usage:
    gutt restore <commit-id>

  Example:
    gutt restore ab75e438

  Tip: run 'gutt log' to see commit IDs.

  restore does NOT move HEAD or change your branch.
  Use --preview to see what will change before writing anything.`)
  .option('-f, --force',   'Skip confirmation prompt for overwrites')
  .option('-p, --preview', 'Preview restore plan without writing any files')
  .action(async (commitId, opts) => {
    const repo = await getRepo();

    // Validate: commit IDs must be hex strings (full 40-char or abbreviated 6-40)
    if (!/^[0-9a-f]{6,40}$/i.test(commitId)) {
      console.log(chalk.red('\n  ✗  Invalid commit ID: "' + commitId + '"'));
      console.log(chalk.yellow('\n  Usage:'));
      console.log(chalk.white('    gutt restore <commit-id>'));
      console.log(chalk.white('    gutt restore ab75e438'));
      console.log(chalk.gray('\n  Run \'gutt log\' to see valid commit IDs.\n'));
      return;
    }

    await restoreCommand(commitId, { force: opts.force, preview: opts.preview }, repo);
  });

program
  .command('stash [subcommand] [args...]')
  .description('Save and restore uncommitted changes')
  .addHelpText('after', `
  Subcommands:
    gutt stash [label]        Save current changes (staged + modified)
    gutt stash list           List all saved stashes
    gutt stash apply [id]     Restore a stash (default: most recent)
    gutt stash drop <id>      Delete a saved stash
  `)
  .action(async (subcommand, args, opts) => {
    const repo = await getRepo();
    await stashCommand(subcommand, args || [], repo);
  });

program
  .command('merge <branch>')
  .description('Merge another branch into the current branch')
  .option('--no-ff', 'Force a merge commit even if fast-forward is possible')
  .action(async (branch, opts) => {
    const repo = await getRepo();
    await mergeCommand(branch, repo);
  });

program
  .command('diff [commitA] [commitB]')
  .description('Show changes: working tree vs HEAD, staged vs HEAD, or commit vs commit')
  .option('-s, --staged', 'Show staged changes (index vs HEAD)')
  .addHelpText('after', `
  Modes:
    gutt diff              Unstaged changes (working tree vs HEAD)
    gutt diff --staged     Staged changes (index vs HEAD)
    gutt diff <a> <b>      Diff between two commits (short or full hashes)`)
  .action(async (commitA, commitB, opts) => {
    const repo = await getRepo();
    await diffCommand(repo, {
      staged:  opts.staged || false,
      commitA: commitA || null,
      commitB: commitB || null,
    });
  });

program
  .command('push <remotePath>')
  .description('Push repository data to a remote location')
  .action(async (remotePath) => {

    const repo = await getRepo();

    const manager =
      new RemoteManager();

    await manager.push(
      repo.workingDir,
      remotePath
    );
  });

program
  .command('clone <remotePath> <targetDir>')
  .description('Clone a repository into a new directory')
  .action(async (remotePath, targetDir) => {

    const manager =
      new CloneManager();

    await manager.clone(
      remotePath,
      targetDir
    );
  });

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}

program.parse(process.argv);
