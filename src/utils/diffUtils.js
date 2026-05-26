// 'use strict';

// const { diffLines } = require('diff');

// /**
//  * Computes a line-level diff between two text strings.
//  *
//  * Returns an array of change objects: { value, added, removed, count }
//  * This is the raw diff used by both the display layer and the analytics layer.
//  */
// function computeDiff(oldContent, newContent) {
//   return diffLines(oldContent || '', newContent || '');
// }

// /**
//  * Summarizes a diff into { added, removed } line counts.
//  * Used for status display (+24 -3) and commit analytics.
//  */
// function summarizeDiff(diff) {
//   let added = 0;
//   let removed = 0;
//   for (const part of diff) {
//     if (part.added)   added   += part.count || 1;
//     if (part.removed) removed += part.count || 1;
//   }
//   return { added, removed };
// }

// /**
//  * Full diff summary from two raw content strings.
//  * Convenience wrapper combining computeDiff + summarizeDiff.
//  */
// function diffSummary(oldContent, newContent) {
//   return summarizeDiff(computeDiff(oldContent, newContent));
// }

// module.exports = { computeDiff, summarizeDiff, diffSummary };



'use strict';

const { diffLines } = require('diff');

/**
 * Safely normalizes content to UTF-8 strings.
 * Prevents corrupted unicode rendering like:
 * ��hello gutt
 */
function normalizeContent(content) {
  if (content === null || content === undefined) {
    return '';
  }

  // Handle Buffer objects safely
  if (Buffer.isBuffer(content)) {
    return content.toString('utf8');
  }

  // Ensure string normalization
  return Buffer.from(String(content), 'utf8').toString('utf8');
}

/**
 * Computes a clean line-level diff between two text strings.
 */
function computeDiff(oldContent, newContent) {
  const oldSafe = normalizeContent(oldContent);
  const newSafe = normalizeContent(newContent);

  return diffLines(oldSafe, newSafe);
}

/**
 * Summarizes a diff into { added, removed } line counts.
 */
function summarizeDiff(diff) {
  let added = 0;
  let removed = 0;

  for (const part of diff) {
    if (part.added) {
      added += part.count || 1;
    }

    if (part.removed) {
      removed += part.count || 1;
    }
  }

  return { added, removed };
}

/**
 * Full diff summary helper.
 */
function diffSummary(oldContent, newContent) {
  return summarizeDiff(computeDiff(oldContent, newContent));
}

/**
 * Converts raw diff output into cleaner semantic operations:
 *
 *   + added line
 *   - removed line
 *   ~ modified old → new
 *
 * This pairs adjacent remove/add blocks into a single modification.
 */
function normalizeDiff(diff) {
  const normalized = [];

  for (let i = 0; i < diff.length; i++) {
    const current = diff[i];
    const next = diff[i + 1];

    // Detect remove followed immediately by add = modification
    if (current.removed && next && next.added) {
      const oldLines = current.value.split('\n').filter(Boolean);
      const newLines = next.value.split('\n').filter(Boolean);

      const max = Math.max(oldLines.length, newLines.length);

      for (let j = 0; j < max; j++) {
        const oldLine = oldLines[j];
        const newLine = newLines[j];

        if (oldLine && newLine) {
          normalized.push({
            type: 'modified',
            oldValue: oldLine,
            newValue: newLine,
          });
        } else if (oldLine) {
          normalized.push({
            type: 'removed',
            value: oldLine,
          });
        } else if (newLine) {
          normalized.push({
            type: 'added',
            value: newLine,
          });
        }
      }

      i++; // Skip next block (already consumed)
      continue;
    }

    // Plain additions
    if (current.added) {
      const lines = current.value.split('\n').filter(Boolean);

      for (const line of lines) {
        normalized.push({
          type: 'added',
          value: line,
        });
      }

      continue;
    }

    // Plain removals
    if (current.removed) {
      const lines = current.value.split('\n').filter(Boolean);

      for (const line of lines) {
        normalized.push({
          type: 'removed',
          value: line,
        });
      }
    }
  }

  return normalized;
}

module.exports = {
  computeDiff,
  summarizeDiff,
  diffSummary,
  normalizeDiff,
};