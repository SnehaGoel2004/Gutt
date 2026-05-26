'use strict';

const chalk           = require('chalk');
const HotspotAnalyzer = require('../analytics/HotspotAnalyzer');

/**
 * heatLevel — threshold-based heat rendering.
 *
 * Uses ABSOLUTE commit counts, not relative ratios.
 * A file touched once is always 🔥, not 🔥🔥🔥🔥🔥.
 * This makes the output analytically meaningful regardless of repo size.
 */
function heatLevel(count) {
  if (count >= 15) return '🔥🔥🔥🔥🔥';
  if (count >= 10) return '🔥🔥🔥🔥';
  if (count >= 6)  return '🔥🔥🔥';
  if (count >= 3)  return '🔥🔥';
  return '🔥';
}

/**
 * `gutt hotspots`
 *
 * Shows a ranked heatmap of the most frequently changed files.
 * Heat levels are threshold-based on real commit frequency —
 * not relative to other files in the repo.
 *
 * Interpretation guide shown at the bottom gives engineers
 * actionable context rather than raw numbers alone.
 */
async function hotspotsCommand(repo) {
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    console.log(chalk.yellow('\n  No commits to analyze.\n'));
    return;
  }

  const history  = await repo.commits.getHistory(headHash);
  const analyzer = new HotspotAnalyzer();
  const spots    = analyzer.analyze(history);

  console.log(chalk.bold.cyan('\n  FILE CHANGE HEATMAP'));
  console.log(chalk.gray('  ' + '─'.repeat(54)));

  if (spots.length === 0) {
    console.log(chalk.gray('  No data.\n'));
    return;
  }

  const maxLen = Math.max(...spots.map(s => s.path.length));

  for (const spot of spots) {
    const flames = heatLevel(spot.commitCount);
    const padded = spot.path.padEnd(maxLen + 2);
    // Right-align the count column regardless of flame width
    const count  = chalk.gray(`${spot.commitCount}x`);
    console.log(`  ${chalk.white(padded)} ${flames}  ${count}`);
  }

  // Summary line for the hottest file
  const top = spots[0];
  let riskNote = '';
  if (top.commitCount >= 10) {
    riskNote = chalk.red('  ⚠ High churn — consider refactoring');
  } else if (top.commitCount >= 6) {
    riskNote = chalk.yellow('  △ Moderate churn');
  }

  console.log(chalk.bold(`\n  Hottest: ${top.path}`) + chalk.gray(` (${top.commitCount} commits)`) + riskNote);

  // Key
  console.log(chalk.gray('\n  Key: 🔥=1-2  🔥🔥=3-5  🔥🔥🔥=6-9  🔥🔥🔥🔥=10-14  🔥🔥🔥🔥🔥=15+\n'));
}

module.exports = hotspotsCommand;
