'use strict';

/**
 * InsightsEngine derives meaningful analytics from commit history.
 *
 * All data comes from the commit chain — no external tracking required.
 * This is "intelligent" in the sense that it reveals patterns that are
 * invisible when looking at individual commits.
 *
 * Metrics produced:
 *   - Most frequently modified files
 *   - Most active day of the week
 *   - Most active hour of day
 *   - Average files per commit
 *   - Total lines added/removed across history
 *   - Commit velocity (commits per day over last 7 days)
 */
class InsightsEngine {
  /**
   * Computes full repository insights from a commit history array.
   *
   * @param {Array} history - from CommitStorage.getHistory()
   *                          each element: { hash, message, timeStamp, files, parent, branch }
   * @returns {Object} insights
   */
  compute(history) {
    if (!history || history.length === 0) {
      return { empty: true };
    }

    const fileFrequency = {};   // path → commit count
    const dayFrequency  = {};   // "Monday" → commit count
    const hourFrequency = {};   // 0..23 → commit count
    const branchCounts  = {};   // branchName → commit count

    let totalFilesTouched = 0;

    for (const commit of history) {
      // Day/hour tracking
      const date  = new Date(commit.timeStamp);
      const day   = date.toLocaleDateString('en-US', { weekday: 'long' });
      const hour  = date.getHours();
      dayFrequency[day]    = (dayFrequency[day]    || 0) + 1;
      hourFrequency[hour]  = (hourFrequency[hour]  || 0) + 1;

      // Branch tracking
      const branch = commit.branch || 'main';
      branchCounts[branch] = (branchCounts[branch] || 0) + 1;

      // File frequency
      for (const file of commit.files || []) {
        fileFrequency[file.path] = (fileFrequency[file.path] || 0) + 1;
        totalFilesTouched++;
      }
    }

    // Sort helpers
    const topEntries = (obj, n = 5) =>
      Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

    // Commit velocity: commits in last 7 days
    const now     = Date.now();
    const week    = 7 * 24 * 60 * 60 * 1000;
    const recent  = history.filter(c => now - new Date(c.timeStamp).getTime() < week);

    return {
      empty:              false,
      totalCommits:       history.length,
      totalFilesTouched,
      avgFilesPerCommit:  (totalFilesTouched / history.length).toFixed(1),
      topFiles:           topEntries(fileFrequency),
      mostActiveDay:      topEntries(dayFrequency, 1)[0]?.[0] || 'N/A',
      mostActiveHour:     topEntries(hourFrequency, 1)[0]?.[0] ?? 'N/A',
      dayBreakdown:       dayFrequency,
      branchCounts,
      recentVelocity:     recent.length, // commits in last 7 days
      firstCommitDate:    history[history.length - 1]?.timeStamp,
      lastCommitDate:     history[0]?.timeStamp,
    };
  }
}

module.exports = InsightsEngine;
