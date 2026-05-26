'use strict';

/**
 * HotspotAnalyzer identifies "hot" files — files that change frequently.
 *
 * Why this matters for developers:
 *   High-churn files are often:
 *   - Poorly designed (too many responsibilities → changed often)
 *   - Active development zones (expected, not a problem)
 *   - Bug-prone areas (modified repeatedly to fix issues)
 *
 * This is a real software engineering metric. Tools like CodeClimate
 * and SonarQube track file churn. Gutt surfaces it visually.
 *
 * Scoring model:
 *   churnScore = commitCount × recencyWeight
 *   Where recencyWeight gives higher score to files changed recently.
 *   This means a file changed 10 times last week scores higher than
 *   one changed 10 times a year ago.
 */
class HotspotAnalyzer {
  /**
   * Analyzes commit history and returns ranked hotspot data.
   *
   * @param {Array} history - from CommitStorage.getHistory()
   * @returns {Array} hotspots sorted by churn score descending
   *   Each entry: { path, commitCount, churnScore, lastModified, heat }
   */
  analyze(history) {
    if (!history || history.length === 0) return [];

    const fileData = {}; // path → { count, lastSeen, timestamps[] }
    const now      = Date.now();

    for (const commit of history) {
      const commitTime = new Date(commit.timeStamp).getTime();
      for (const file of commit.files || []) {
        if (!fileData[file.path]) {
          fileData[file.path] = { count: 0, lastSeen: commitTime, timestamps: [] };
        }
        fileData[file.path].count++;
        fileData[file.path].timestamps.push(commitTime);
        if (commitTime > fileData[file.path].lastSeen) {
          fileData[file.path].lastSeen = commitTime;
        }
      }
    }

    // Compute churn score with recency weighting
    const results = Object.entries(fileData).map(([filePath, data]) => {
      // Recency weight: files modified in last 7 days get 2x, last 30 days 1.5x, older 1x
      const daysSinceLastEdit = (now - data.lastSeen) / (1000 * 60 * 60 * 24);
      const recencyWeight = daysSinceLastEdit < 7 ? 2.0 : daysSinceLastEdit < 30 ? 1.5 : 1.0;
      const churnScore = data.count * recencyWeight;

      return {
        path:         filePath,
        commitCount:  data.count,
        churnScore:   Math.round(churnScore * 10) / 10,
        lastModified: new Date(data.lastSeen).toISOString(),
      };
    });

    // Sort by churn score descending
    results.sort((a, b) => b.churnScore - a.churnScore);

    // Assign heat levels (1–5) relative to the top scorer
    const maxScore = results[0]?.churnScore || 1;
    for (const r of results) {
      r.heat = Math.ceil((r.churnScore / maxScore) * 5);
    }

    return results;
  }
}

module.exports = HotspotAnalyzer;
