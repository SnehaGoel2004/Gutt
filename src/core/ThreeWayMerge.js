'use strict';

/**
 * ThreeWayMerge
 *
 * Real 3-way merge engine.
 *
 * Compares:
 *   BASE
 *   CURRENT
 *   INCOMING
 *
 * Used for:
 *   - automatic merges
 *   - conflict detection
 *   - merge commits
 *
 * This is the core algorithm behind real version control systems.
 */

class ThreeWayMerge {

  /**
   * Merge three versions of a file.
   *
   * Returns:
   * {
   *   merged: string,
   *   conflict: boolean
   * }
   */
  merge(baseContent, currentContent, incomingContent) {

    const base     = baseContent     || '';
    const current  = currentContent  || '';
    const incoming = incomingContent || '';

    // CASE 1:
    // Current unchanged → accept incoming
    if (current === base) {
      return {
        merged: incoming,
        conflict: false,
      };
    }

    // CASE 2:
    // Incoming unchanged → keep current
    if (incoming === base) {
      return {
        merged: current,
        conflict: false,
      };
    }

    // CASE 3:
    // Both made identical changes
    if (current === incoming) {
      return {
        merged: current,
        conflict: false,
      };
    }

    // CASE 4:
    // Real conflict
    return {
      conflict: true,

      merged:
`<<<<<<< CURRENT
${current}
=======
${incoming}
>>>>>>> INCOMING`
    };
  }
}

module.exports = ThreeWayMerge;