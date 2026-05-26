'use strict';

const chalk         = require('chalk');
const ChurnDetector = require('../analytics/ChurnDetector');

const RISK_COLORS = {
  CRITICAL: chalk.red.bold,
  HIGH:     chalk.red,
  MODERATE: chalk.yellow,
  LOW:      chalk.gray,
};

const RISK_ICONS = {
  CRITICAL: '🔴',
  HIGH:     '🟠',
  MODERATE: '🟡',
  LOW:      '🟢',
};

/**
 * `gutt churn`
 *
 * Identifies files with dangerous modification velocity.
 * High churn correlates with architectural instability, bug-prone areas,
 * and missing abstractions — this is a real software engineering metric.
 *
 * Output format:
 *   RISK  FILE                commits  velocity  recent(14d)  span
 */
async function churnCommand(repo, { days = 14, min = 3 } = {}) {
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    console.log(chalk.yellow('\n  No commits to analyze.\n'));
    return;
  }

  const history  = await repo.commits.getHistory(headHash);
  const detector = new ChurnDetector();
  const reports  = detector.analyze(history, { windowDays: days, minCommits: min });

  console.log(chalk.bold.cyan('\n  CHURN ANALYSIS — File Modification Risk'));
  console.log(chalk.gray('  ' + '─'.repeat(60)));
  console.log(chalk.gray(`  Window: last ${days} days  ·  Min commits to report: ${min}\n`));

  if (reports.length === 0) {
    console.log(chalk.green('  ✔ No high-churn files detected. Architecture looks stable.\n'));
    return;
  }

  const maxPathLen = Math.max(...reports.map(r => r.path.length), 12);
  const header = [
    'RISK    ',
    'FILE'.padEnd(maxPathLen + 2),
    'COMMITS',
    'VEL/DAY',
    `RECENT(${days}d)`,
    'SPAN',
  ].join('  ');
  console.log(chalk.gray(`  ${header}`));
  console.log(chalk.gray('  ' + '─'.repeat(header.length + 2)));

  for (const r of reports) {
    const color    = RISK_COLORS[r.riskLevel] || chalk.white;
    const icon     = RISK_ICONS[r.riskLevel];
    const riskStr  = `${icon} ${r.riskLevel}`.padEnd(12);
    const pathStr  = r.path.padEnd(maxPathLen + 2);
    const commits  = String(r.totalCommits).padStart(7);
    const vel      = String(r.velocity).padStart(7);
    const recent   = String(r.recentCommits).padStart(11);
    const span     = `${r.spanDays}d`.padStart(5);

    console.log(color(`  ${riskStr}${pathStr}${commits}  ${vel}  ${recent}  ${span}`));
  }

  // Summary insights
  const critical = reports.filter(r => r.riskLevel === 'CRITICAL');
  const high     = reports.filter(r => r.riskLevel === 'HIGH');

  if (critical.length > 0) {
    console.log(chalk.red.bold(`\n  ⚠ ${critical.length} CRITICAL file(s) — immediate refactoring recommended:`));
    for (const r of critical) {
      console.log(chalk.red(`    ${r.path} — ${r.totalCommits} commits over ${r.spanDays} days`));
    }
  }
  if (high.length > 0) {
    console.log(chalk.yellow(`\n  △ ${high.length} HIGH-risk file(s) — consider reviewing architecture`));
  }

  console.log(chalk.gray('\n  Interpretation:'));
  console.log(chalk.gray('  VEL/DAY = average commits per day over file lifetime'));
  console.log(chalk.gray(`  RECENT  = commits in last ${days} days\n`));
}

module.exports = churnCommand;
