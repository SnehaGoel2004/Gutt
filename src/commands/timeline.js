'use strict';

const chalk = require('chalk');

/**
 * `gutt timeline`
 *
 * Development activity analytics from commit timestamps.
 * No external dependencies — pure arithmetic on history data.
 *
 * Sections:
 *   1. Hourly activity histogram (proportional bars, peak highlighted)
 *   2. Daily activity — last 14 days (proportional bars)
 *   3. Summary stats — avg commits/day, peak hour, weekday vs weekend ratio
 *   4. Commit streaks
 *   5. Weekly distribution
 */
async function timelineCommand(repo) {
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    console.log(chalk.yellow('\n  No commits to analyze.\n'));
    return;
  }

  const history = await repo.commits.getHistory(headHash);

  if (history.length < 2) {
    console.log(chalk.yellow('\n  Need at least 2 commits for timeline analysis.\n'));
    return;
  }

  console.log(chalk.bold.cyan('\n  DEVELOPMENT TIMELINE ANALYTICS'));
  console.log(chalk.gray('  ' + '─'.repeat(56)));
  console.log(chalk.gray(`  Based on ${history.length} commits\n`));

  _renderSummaryStats(history);
  _renderHourlyHistogram(history);
  _renderDailyActivity(history);
  _renderStreaks(history);
  _renderWeeklyDistribution(history);
}

// ── Summary stats ────────────────────────────────────────────────────────────

function _renderSummaryStats(history) {
  const timestamps = history.map(c => new Date(c.timeStamp).getTime());
  const oldest     = Math.min(...timestamps);
  const newest     = Math.max(...timestamps);
  const spanDays   = Math.max((newest - oldest) / 86400000, 1);
  const avgPerDay  = (history.length / spanDays).toFixed(2);

  // Peak hour
  const hourCounts = new Array(24).fill(0);
  history.forEach(c => hourCounts[new Date(c.timeStamp).getHours()]++);
  const peakHour   = hourCounts.indexOf(Math.max(...hourCounts));

  // Weekday vs weekend
  let weekdayCount = 0;
  let weekendCount = 0;
  history.forEach(c => {
    const day = new Date(c.timeStamp).getDay(); // 0=Sun, 6=Sat
    if (day === 0 || day === 6) weekendCount++;
    else weekdayCount++;
  });
  const weekdayPct = Math.round((weekdayCount / history.length) * 100);
  const weekendPct = 100 - weekdayPct;

  // Active hours (hours with at least one commit)
  const activeHours = hourCounts.filter(n => n > 0).length;

  const peakLabel = peakHour < 12
    ? `${peakHour}:00 AM`
    : peakHour === 12
      ? '12:00 PM'
      : `${peakHour - 12}:00 PM`;

  console.log(chalk.bold('  Summary\n'));
  console.log(`  Avg commits/day   ${chalk.bold(avgPerDay)}`);
  console.log(`  Peak coding hour  ${chalk.bold(peakLabel)}  ${chalk.gray(`(${hourCounts[peakHour]} commits)`)}`);
  console.log(`  Active hours/day  ${chalk.bold(activeHours)} ${chalk.gray('unique hours with commits')}`);
  console.log(
    `  Weekday commits   ${chalk.green(weekdayCount)} ${chalk.gray(`(${weekdayPct}%)`)}  ` +
    `Weekend: ${chalk.yellow(weekendCount)} ${chalk.gray(`(${weekendPct}%)`)}`,
  );
  console.log();
}

// ── Hourly histogram ─────────────────────────────────────────────────────────

function _renderHourlyHistogram(history) {
  const hourCounts = new Array(24).fill(0);
  history.forEach(c => hourCounts[new Date(c.timeStamp).getHours()]++);

  const maxCount = Math.max(...hourCounts, 1);
  const peakHour = hourCounts.indexOf(maxCount);

  console.log(chalk.bold('  Commits by hour of day\n'));

  // Horizontal bars: each hour on its own row.
  // Width is proportional to max, not fixed — so bars actually reflect relative activity.
  const BAR_MAX = 28; // max bar width in characters

  for (let h = 0; h < 24; h++) {
    const count  = hourCounts[h];
    const barLen = count > 0 ? Math.max(1, Math.round((count / maxCount) * BAR_MAX)) : 0;
    const isPeak = h === peakHour && count > 0;

    const label   = String(h).padStart(2, '0');
    const barChar = isPeak ? chalk.bold.green('█') : h >= 9 && h <= 17 ? chalk.green('█') : h >= 18 && h <= 22 ? chalk.yellow('█') : chalk.gray('█');
    const bar     = count > 0 ? barChar.repeat(barLen) : chalk.gray('·');
    const countLabel = count > 0
      ? (isPeak ? chalk.bold.green(String(count).padStart(3)) : chalk.white(String(count).padStart(3)))
      : chalk.gray('  0');
    const peakTag = isPeak ? chalk.bold.green(' ◀ peak') : '';

    console.log(`  ${chalk.gray(label)}  ${bar}${countLabel}${peakTag}`);
  }

  console.log(chalk.gray(`\n  ${chalk.green('▓')} Work hours (9-17)  ${chalk.yellow('▓')} Evening  ${chalk.gray('▓')} Night\n`));
}

// ── Daily activity ───────────────────────────────────────────────────────────

function _renderDailyActivity(history) {
  const now    = Date.now();
  const days   = 14;
  const counts = new Array(days).fill(0);
  const labels = [];

  for (let i = 0; i < days; i++) {
    const d        = new Date(now - i * 86400000);
    const label    = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    labels.unshift(label);

    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayEnd   = dayStart + 86400000;
    counts[days - 1 - i] = history.filter(c => {
      const t = new Date(c.timeStamp).getTime();
      return t >= dayStart && t < dayEnd;
    }).length;
  }

  const max     = Math.max(...counts, 1);
  const BAR_MAX = 20;

  console.log(chalk.bold('  Last 14 days\n'));

  for (let i = 0; i < days; i++) {
    const count  = counts[i];
    const barLen = count > 0 ? Math.max(1, Math.round((count / max) * BAR_MAX)) : 0;
    const filled = count > 0 ? chalk.cyan('█'.repeat(barLen)) : '';
    const empty  = chalk.gray('░'.repeat(BAR_MAX - barLen));
    const label  = chalk.gray(labels[i].padEnd(8));
    const num    = count > 0 ? chalk.white(String(count).padStart(2)) : chalk.gray(' 0');
    console.log(`  ${label}  ${filled}${empty}  ${num}`);
  }
  console.log();
}

// ── Streaks ──────────────────────────────────────────────────────────────────

function _renderStreaks(history) {
  const commitDates = new Set(
    history.map(c => new Date(c.timeStamp).toISOString().slice(0, 10))
  );

  // Current streak: consecutive days ending today or yesterday
  let currentStreak = 0;
  const today = new Date();

  for (let i = 0; i <= 365; i++) {
    const d       = new Date(today.getTime() - i * 86400000);
    const dateStr = d.toISOString().slice(0, 10);
    if (commitDates.has(dateStr)) {
      currentStreak++;
    } else if (i === 0) {
      // No commit today yet — check if yesterday starts a streak
      break;
    } else {
      break;
    }
  }

  // Longest streak
  let longestStreak = currentStreak;
  const sortedDates = [...commitDates].sort();
  let run = 1;
  for (let i = 1; i < sortedDates.length; i++) {
    const gap = (new Date(sortedDates[i]) - new Date(sortedDates[i - 1])) / 86400000;
    if (gap === 1) {
      run++;
      if (run > longestStreak) longestStreak = run;
    } else {
      run = 1;
    }
  }

  console.log(chalk.bold('  Commit streaks\n'));
  const currentColor = currentStreak >= 7 ? chalk.bold.green
    : currentStreak >= 3 ? chalk.yellow
    : chalk.white;
  console.log(`  Current streak   ${currentColor(currentStreak + ' day' + (currentStreak !== 1 ? 's' : ''))}`);
  console.log(`  Longest streak   ${chalk.cyan(longestStreak + ' day' + (longestStreak !== 1 ? 's' : ''))}`);
  console.log(`  Active days      ${chalk.white(commitDates.size)}`);
  console.log();
}

// ── Weekly distribution ──────────────────────────────────────────────────────

function _renderWeeklyDistribution(history) {
  const dayNames  = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dayCounts = new Array(7).fill(0);

  history.forEach(c => {
    // getDay(): 0=Sun → map to Mon=0 index
    const day = (new Date(c.timeStamp).getDay() + 6) % 7;
    dayCounts[day]++;
  });

  const max     = Math.max(...dayCounts, 1);
  const BAR_MAX = 24;

  console.log(chalk.bold('  Weekly distribution\n'));
  for (let i = 0; i < 7; i++) {
    const count     = dayCounts[i];
    const barLen    = count > 0 ? Math.max(1, Math.round((count / max) * BAR_MAX)) : 0;
    const isWeekend = i >= 5;
    const bar       = count > 0
      ? (isWeekend ? chalk.yellow : chalk.green)('█'.repeat(barLen))
      : chalk.gray('·');
    const pct       = Math.round((count / history.length) * 100);
    const label     = chalk.gray(dayNames[i]);
    const num       = chalk.white(String(count).padStart(3));
    const pctLabel  = chalk.gray(`${String(pct).padStart(3)}%`);
    console.log(`  ${label}  ${bar.padEnd(24)}  ${num}  ${pctLabel}`);
  }
  console.log();
}

module.exports = timelineCommand;
