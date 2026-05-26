'use strict';

/**
 * ChurnDetector — identifies files with dangerous modification velocity.
 *
 * "Churn" in software engineering = the rate at which a file changes.
 * High churn is a leading indicator of:
 *   - Poor separation of concerns (file does too much)
 *   - Active bug areas (modified repeatedly to fix regressions)
 *   - Unstable APIs (interface keeps changing)
 *   - Missing abstractions (every new feature touches the same file)
 *
 * This metric is used by tools like CodeClimate, SonarQube, and
 * Microsoft's internal research tools that correlate churn with defect rates.
 *
 * Detection model:
 *   1. ABSOLUTE FREQUENCY  — raw commit count for the file
 *   2. VELOCITY            — commits per day (frequency / time span)
 *   3. RECENCY SPIKE       — disproportionate recent activity vs historical rate
 *   4. RISK LEVEL          — LOW / MODERATE / HIGH / CRITICAL
 */
class ChurnDetector {
  /**
   * Analyzes commit history and returns churn reports for risky files.
   *
   * @param {Array}  history     — from CommitStorage.getHistory()
   * @param {Object} options
   * @param {number} options.minCommits    — minimum commits to consider (default: 3)
   * @param {number} options.windowDays   — recency window in days (default: 14)
   * @returns {Array<ChurnReport>}
   */
  analyze(history, { minCommits = 3, windowDays = 14 } = {}) {
    if (!history || history.length === 0) return [];

    const now        = Date.now();
    const windowMs   = windowDays * 86400000;
    const fileData   = {};

    for (const commit of history) {
      const t = new Date(commit.timeStamp).getTime();
      for (const file of (commit.files || [])) {
        if (!fileData[file.path]) {
          fileData[file.path] = { timestamps: [], path: file.path };
        }
        fileData[file.path].timestamps.push(t);
      }
    }

    const reports = [];

    for (const data of Object.values(fileData)) {
      const { path: filePath, timestamps } = data;
      const totalCommits = timestamps.length;

      if (totalCommits < minCommits) continue;

      // Sort oldest → newest
      timestamps.sort((a, b) => a - b);

      const oldestMs  = timestamps[0];
      const newestMs  = timestamps[timestamps.length - 1];
      const spanDays  = Math.max((newestMs - oldestMs) / 86400000, 1);
      const velocity  = totalCommits / spanDays; // commits per day (lifetime)

      // Recency: commits in the windowDays window
      const recentCommits = timestamps.filter(t => now - t <= windowMs).length;
      const recentVelocity = recentCommits / windowDays; // commits per day (recent)

      // Spike ratio: how much faster is recent activity vs historical?
      const spikeRatio = velocity > 0 ? recentVelocity / velocity : 0;

      const riskLevel = this._riskLevel(totalCommits, velocity, recentCommits, spikeRatio);

      reports.push({
        path:            filePath,
        totalCommits,
        spanDays:        Math.round(spanDays),
        velocity:        Math.round(velocity * 10) / 10,  // commits/day
        recentCommits,
        recentVelocity:  Math.round(recentVelocity * 100) / 100,
        spikeRatio:      Math.round(spikeRatio * 10) / 10,
        riskLevel,
        lastModified:    new Date(newestMs).toISOString(),
      });
    }

    // Sort: CRITICAL first, then by total commits
    const riskOrder = { CRITICAL: 0, HIGH: 1, MODERATE: 2, LOW: 3 };
    reports.sort((a, b) =>
      (riskOrder[a.riskLevel] - riskOrder[b.riskLevel]) ||
      (b.totalCommits - a.totalCommits)
    );

    return reports;
  }

  /**
   * Assigns a risk level based on multiple signals.
   * Uses a scoring model, not a single threshold.
   */
  _riskLevel(totalCommits, velocity, recentCommits, spikeRatio) {
    let score = 0;

    // Absolute frequency
    if (totalCommits >= 20) score += 4;
    else if (totalCommits >= 10) score += 3;
    else if (totalCommits >= 6)  score += 2;
    else if (totalCommits >= 3)  score += 1;

    // Velocity (commits per day)
    if (velocity >= 2)   score += 3;
    else if (velocity >= 1)   score += 2;
    else if (velocity >= 0.5) score += 1;

    // Recent spike
    if (recentCommits >= 8)  score += 3;
    else if (recentCommits >= 4) score += 2;
    else if (recentCommits >= 2) score += 1;

    // Spike ratio (recent acceleration)
    if (spikeRatio >= 3) score += 2;
    else if (spikeRatio >= 2) score += 1;

    if (score >= 9)  return 'CRITICAL';
    if (score >= 6)  return 'HIGH';
    if (score >= 3)  return 'MODERATE';
    return 'LOW';
  }
}

module.exports = ChurnDetector;
