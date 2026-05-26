'use strict';

const chalk          = require('chalk');
const InsightsEngine = require('../analytics/InsightsEngine');

/**
 * `gutt insights`
 *
 * Repository analytics derived entirely from commit history.
 *
 * Bar rendering fix: bars use relative scaling (max = 20 chars) with
 * percentage shown alongside the raw count. When all files have 1 commit,
 * they correctly show equal bars — that IS the correct information.
 * The percentage column adds context that raw counts alone lack.
 *
 * Added metrics:
 *   - % share of all file modifications
 *   - churn rank (#1, #2, ...)
 *   - average commit size trend
 *   - recent vs historical velocity comparison
 */
async function insightsCommand(repo) {
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    console.log(chalk.yellow('\n  No commits to analyze yet.\n'));
    return;
  }

  const history = await repo.commits.getHistory(headHash);
  const engine  = new InsightsEngine();
  const data    = engine.compute(history);

  if (data.empty) {
    console.log(chalk.yellow('\n  Not enough data for insights.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n  REPOSITORY INSIGHTS'));
  console.log(chalk.gray('  ' + '─'.repeat(52)));

  const commitDates = history.map(c => new Date(c.timeStamp).getTime());
  const oldestCommit = Math.min(...commitDates);
  const newestCommit = Math.max(...commitDates);
  const repoAgeDays = Math.max(
    1,
    Math.ceil(
      (newestCommit - oldestCommit) /
      (1000 * 60 * 60 * 24)
    )
  );

  // ── Summary metrics ───────────────────────────────────────────────────────
  const velocityTrend = data.recentVelocity > data.totalCommits / 4
    ? chalk.green('↑ accelerating')
    : chalk.gray('→ steady');

  console.log(`\n  Total commits        ${chalk.bold(data.totalCommits)}`);
  console.log(`  Repository age       ${chalk.bold(repoAgeDays + ' day(s)')}`);
  console.log(`  Commits (last 7d)    ${chalk.bold(data.recentVelocity)}  ${velocityTrend}`);
  console.log(`  Avg files/commit     ${chalk.bold(data.avgFilesPerCommit)}`);
  console.log(`  Most active day      ${chalk.bold(data.mostActiveDay)}`);
  console.log(`  Peak coding hour     ${chalk.bold(data.mostActiveHour + ':00')}`);
  // ── Risk analysis ───────────────────────────────────────────────────────
  const riskyFiles = data.topFiles.filter(([, count]) => count >= 3);
  console.log(
    `  Risky files          ${chalk.bold(riskyFiles.length)}`
  );

  // ── Top modified files with percentage + churn rank ───────────────────────
  if (data.topFiles.length > 0) {
    const totalModifications = data.topFiles.reduce((s, [, c]) => s + c, 0);
    const maxCount           = data.topFiles[0][1];
    const BAR_WIDTH          = 16;

    console.log(chalk.bold('\n  Most modified files  (rank · file · bar · count · share)\n'));

    data.topFiles.forEach(([filePath, count], i) => {
      const rank       = `#${i + 1}`.padStart(3);
      const barLen     = Math.max(1, Math.round((count / maxCount) * BAR_WIDTH));
      const bar        = chalk.green('█'.repeat(barLen)) + chalk.gray('░'.repeat(BAR_WIDTH - barLen));
      const pct        = ((count / totalModifications) * 100).toFixed(0);
      const countLabel = chalk.white(String(count).padStart(3) + 'x');
      const pctLabel   = chalk.gray(`${pct}%`.padStart(4));
      const name       = filePath.length > 24 ? '…' + filePath.slice(-23) : filePath.padEnd(24);

      console.log(`  ${chalk.cyan(rank)}  ${chalk.white(name)}  ${bar}  ${countLabel}  ${pctLabel}`);
    });
  }

  // ── Commit size distribution ───────────────────────────────────────────────
  const fileCounts     = history.map(c => (c.files || []).length);
  const singleFile     = fileCounts.filter(n => n === 1).length;
  const smallCommit    = fileCounts.filter(n => n >= 2 && n <= 4).length;
  const largeCommit    = fileCounts.filter(n => n > 4).length;

  if (history.length >= 3) {
    console.log(chalk.bold('\n  Commit size distribution\n'));
    const total = history.length;
    const row = (label, count) => {
      const pct    = Math.round((count / total) * 100);
      const barLen = Math.max(0, Math.round((count / total) * 20));
      const bar    = chalk.cyan('█'.repeat(barLen)) + chalk.gray('░'.repeat(20 - barLen));
      console.log(`  ${label.padEnd(16)} ${bar}  ${String(count).padStart(3)} (${pct}%)`);
    };
    row('Single-file', singleFile);
    row('Small (2-4)', smallCommit);
    row('Large (5+)',  largeCommit);
  }



  // ── Risky files ──────────────────────────────────────────────────────────
  if (riskyFiles.length > 0) {
    console.log(chalk.bold.red('\n  Risky files\n'));
    const maxRisk = riskyFiles[0][1];
    for (const [file, count] of riskyFiles) {
      const barLen =
      Math.max(
        1,
        Math.round((count / maxRisk) * 16)
      );
      const bar =
        chalk.red('█'.repeat(barLen)) +
        chalk.gray('░'.repeat(16 - barLen));
      console.log(
        `  ${file.padEnd(24)} ${bar} ${count} edits`
      );
    }
  }
  
  // ── Branch activity ───────────────────────────────────────────────────────
  if (Object.keys(data.branchCounts).length > 1) {
    console.log(chalk.bold('\n  Commits per branch\n'));
    const maxBranchCount = Math.max(...Object.values(data.branchCounts));
    for (const [branch, count] of Object.entries(data.branchCounts)) {
      const barLen = Math.max(1, Math.round((count / maxBranchCount) * 16));
      const bar    = chalk.cyan('█'.repeat(barLen));
      console.log(`  ${branch.padEnd(20)} ${bar}  ${count}`);
    }
  }

  console.log();
}

module.exports = insightsCommand;
