'use strict';

const chalk                 = require('chalk');
const CommitManager         = require('../core/CommitManager');
const IndexManager          = require('../core/IndexManager');
const CommitSuggestionEngine = require('../analytics/CommitSuggestionEngine');
const { diffSummary }       = require('../utils/diffUtils');
const { shortHash }         = require('../utils/hashUtils');

/**
 * `gutt commit [message]`
 * `gutt commit` — auto-suggests message
 * `gutt commit -s "my message"` — shows suggestion alongside provided message
 *
 * The command layer handles only I/O.
 * CommitManager handles the actual commit pipeline.
 */
async function commitCommand(message, { suggest = false } = {}, repo) {
  const index   = new IndexManager(repo.indexPath);
  const staged  = await index.read();

  if (staged.length === 0) {
    console.log(chalk.yellow('\n  Nothing to commit. Stage files first:'));
    console.log(chalk.gray('  gutt add <file>\n'));
    return;
  }

  // Build diff stats for suggestion engine and output
  const headHash    = await repo.refs.resolveHead();
  const headCommit  = headHash ? await repo.commits.retrieve(headHash) : null;
  const diffStats   = [];

  for (const entry of staged) {
    const prevEntry   = headCommit?.files?.find(f => f.path === entry.path);
    const prevContent = prevEntry ? await repo.blobs.retrieve(prevEntry.hash) : '';
    const currContent = await repo.blobs.retrieve(entry.hash);
    const { added, removed } = diffSummary(prevContent, currContent);
    diffStats.push({ path: entry.path, added, removed });
  }

  // Intent detection with confidence scoring
  const engine     = new CommitSuggestionEngine();
  const suggestion = engine.suggest(staged, diffStats);

  if (!message || suggest) {
    const confidenceColor = suggestion.confidence >= 80
      ? chalk.green
      : suggestion.confidence >= 60
        ? chalk.yellow
        : chalk.gray;

    console.log(
      chalk.cyan('\n  💡 Detected intent: ') +
      chalk.bold.white(suggestion.intent) +
      '  ' + confidenceColor(`(${suggestion.confidence}% confidence)`)
    );
    console.log(chalk.gray('  Suggested message:'));
    console.log(chalk.bold.white(`     "${suggestion.message}"\n`));
  }

  const finalMessage = message || suggestion.message;

  // Delegate to CommitManager
  const mgr    = new CommitManager(index, repo.blobs, repo.commits, repo.refs);
  const result = await mgr.commit(finalMessage);

  if (!result.success) {
    if (result.reason === 'NO_CHANGES') {
      console.log(chalk.yellow('\n  🚫 No meaningful changes detected. Commit skipped.'));
      console.log(chalk.gray('     All staged files are identical to the last commit.\n'));
    } else if (result.reason === 'EMPTY_STAGE') {
      console.log(chalk.yellow('\n  Nothing staged to commit.\n'));
    }
    return;
  }

  // ── Success output (standardized — always shows all fields) ────────────
  const dedup = result.stats.deduplicatedBlobs;
  const snap  = result.stats.newBlobs;

  console.log(chalk.bold.green(`\n  ✔  Committed on branch "${result.branch}"`));
  console.log(
    chalk.gray(`     ${shortHash(result.commitHash)}`) +
    chalk.white(`  "${result.message}"`)
  );
  console.log(
    chalk.gray(`     ${snap} new snapshot${snap !== 1 ? 's' : ''} stored`) +
    (dedup > 0 ? chalk.cyan(`  ·  ${dedup} deduplicated`) : '')
  );

  // Per-file change summary — always shown
  if (diffStats.length > 0) {
    const maxLen = Math.max(...diffStats.map(d => d.path.length));
    console.log();
    for (const d of diffStats) {
      const padded = d.path.padEnd(maxLen + 2);
      console.log(
        chalk.white(`     ${padded}`) +
        chalk.green(`+${d.added}`.padStart(5)) +
        chalk.red(`  -${d.removed}`)
      );
    }

    const mostEdited = [...diffStats].sort(
      (a, b) => (b.added + b.removed) - (a.added + a.removed)
    )[0];
    console.log(chalk.gray(`\n     Most edited: ${mostEdited.path}`));
  }

  console.log();
}

module.exports = commitCommand;
