'use strict';

const path         = require('path');
const fs           = require('fs').promises;
const chalk        = require('chalk');
const IndexManager = require('../core/IndexManager');
const { exists, readFile } = require('../utils/fileUtils');
const { isSensitive }      = require('../utils/ignoreUtils');
const { shortHash }        = require('../utils/hashUtils');

/**
 * `gutt doctor`
 *
 * A real repository integrity scanner — not a superficial status checker.
 *
 * Two tiers of checks:
 *
 * TIER 1 — STRUCTURAL INTEGRITY (filesystem level)
 *   Validates that required files and directories physically exist and
 *   contain parseable content. Corruption at this level means the repo
 *   is broken even before any commands run.
 *
 * TIER 2 — LOGICAL HEALTH (workflow level)
 *   Checks for workflow problems: uncommitted work, sensitive staged files,
 *   oversized commits, stale activity, detached HEAD.
 *
 * Tier 1 failures are shown first and block Tier 2 analysis where relevant,
 * because logical checks are meaningless if the structural layer is corrupt.
 */
async function doctorCommand(repo) {
  console.log(chalk.bold.cyan('\n  GUTT DOCTOR — Repository Integrity Scanner'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const results = [];
  const ok      = (msg)       => results.push({ level: 'ok',   msg });
  const warn    = (msg)       => results.push({ level: 'warn', msg });
  const fail    = (msg)       => results.push({ level: 'fail', msg });

  // ── TIER 1: STRUCTURAL INTEGRITY ────────────────────────────────────────

  console.log(chalk.gray('\n  [Tier 1] Structural integrity\n'));

  // 1a. .gutt directory
  if (!await repo.isInitialized()) {
    fail('No .gutt directory found — not a Gutt repository');
    fail('Run: gutt init');
    printResults(results);
    return;
  }
  ok('.gutt directory exists');

  // 1b. Required subdirectories
  const requiredDirs = [
    path.join(repo.gutDir, 'objects', 'blobs'),
    path.join(repo.gutDir, 'objects', 'commits'),
    path.join(repo.gutDir, 'refs', 'heads'),
  ];
  for (const dir of requiredDirs) {
    if (!await exists(dir)) {
      fail(`Missing required directory: .gutt/${path.relative(repo.gutDir, dir)}`);
    }
  }

  // 1c. HEAD file — must physically exist and be non-empty
  const headFilePath = path.join(repo.gutDir, 'HEAD');
  const headContent  = await readFile(headFilePath);
  if (headContent === null) {
    fail('HEAD file is missing — repository is corrupted');
    fail('Fix: recreate HEAD with:  echo "ref: refs/heads/main" > .gutt/HEAD');
    printResults(results);
    return;
  }
  if (!headContent.trim()) {
    fail('HEAD file exists but is empty — repository is corrupted');
    printResults(results);
    return;
  }
  ok('HEAD file exists and is readable');

  // 1d. Parse HEAD content
  let currentBranch = null;
  let isDetached    = false;
  const trimmedHead = headContent.trim();

  if (trimmedHead.startsWith('ref: ')) {
    currentBranch = trimmedHead.slice(5).replace('refs/heads/', '');
    ok(`HEAD points to branch "${currentBranch}"`);
  } else {
    isDetached = true;
    warn(`HEAD is detached at commit ${shortHash(trimmedHead)}`);
    warn('To return to a branch: gutt checkout main');
  }

  // 1e. Branch ref exists and points to a valid commit
  if (currentBranch) {
    const branchRefPath = path.join(repo.gutDir, 'refs', 'heads', currentBranch);
    const branchHash    = await readFile(branchRefPath);

    if (branchHash === null) {
      // Branch ref missing — only a problem if there should be commits
      // (first commit hasn't happened yet is normal)
      const commitsDir = path.join(repo.gutDir, 'objects', 'commits');
      let commitCount  = 0;
      try {
        const entries = await fs.readdir(commitsDir);
        commitCount = entries.length;
      } catch {}

      if (commitCount > 0) {
        fail(`Branch ref missing: refs/heads/${currentBranch} — branch pointer is broken`);
      }
      // else: no commits yet, this is normal
    } else {
      const hash = branchHash.trim();
      ok(`Branch ref "refs/heads/${currentBranch}" exists → ${shortHash(hash)}`);

      // 1f. Commit object for that hash must exist
      const commitPath = path.join(repo.gutDir, 'objects', 'commits', hash);
      if (!await exists(commitPath)) {
        fail(`Commit object missing: ${shortHash(hash)} — branch pointer is dangling`);
        fail(`The branch "${currentBranch}" points to a commit that no longer exists`);
      } else {
        // 1g. Commit object must be valid JSON
        const commitRaw = await readFile(commitPath);
        try {
          const commit = JSON.parse(commitRaw);
          ok(`HEAD commit object is valid (${shortHash(hash)})`);

          // 1h. Verify blob objects for every file in HEAD commit
          const missingBlobs = [];
          for (const entry of (commit.files || [])) {
            const blobPath = path.join(
              repo.gutDir, 'objects', 'blobs',
              entry.hash.substring(0, 2),
              entry.hash.substring(2)
            );
            if (!await exists(blobPath)) {
              missingBlobs.push(entry.path);
            }
          }
          if (missingBlobs.length > 0) {
            fail(`Missing blob objects for: ${missingBlobs.join(', ')}`);
          } else if ((commit.files || []).length > 0) {
            ok(`All blob objects present for HEAD commit`);
          }
        } catch {
          fail(`Commit object is corrupted (invalid JSON): ${shortHash(hash)}`);
        }
      }
    }
  }

  // 1i. Index file must exist and be parseable
  const indexContent = await readFile(repo.indexPath);
  if (indexContent === null) {
    fail('index file is missing — staging area is inaccessible');
  } else {
    try {
      JSON.parse(indexContent);
      ok('index file is valid JSON');
    } catch {
      fail('index file is corrupted (invalid JSON) — staging area data is lost');
    }
  }

  // ── TIER 2: LOGICAL HEALTH ───────────────────────────────────────────────

  const hasStructuralFailures = results.some(r => r.level === 'fail');
  if (hasStructuralFailures) {
    console.log(chalk.red('\n  Structural failures detected — skipping logical health checks.\n'));
    printResults(results);
    return;
  }

  console.log(chalk.gray('\n  [Tier 2] Workflow health\n'));

  // 2a. Any commits?
  const headHash = await repo.refs.resolveHead();
  if (!headHash) {
    warn('No commits yet');
  } else {
    ok('Repository has commit history');
  }

  // 2b. Staging area state
  const index  = new IndexManager(repo.indexPath);
  const staged = await index.read();
  if (staged.length > 0) {
    warn(`${staged.length} file(s) staged but not yet committed`);
  } else {
    ok('Staging area is clean');
  }

  // 2c. Sensitive files staged
  const sensitivelyStagedFiles = staged.filter(f => isSensitive(f.path));
  if (sensitivelyStagedFiles.length > 0) {
    fail(`Sensitive file(s) in staging area: ${sensitivelyStagedFiles.map(f => f.path).join(', ')}`);
  }

  // 2d. .guttignore present
  const hasIgnore = await exists(path.join(repo.workingDir, '.guttignore'));
  if (!hasIgnore) {
    warn('No .guttignore — sensitive files (e.g. .env) are unprotected');
  } else {
    ok('.guttignore is present');
  }

  // 2e. Oversized last commit
  if (headHash) {
    const lastCommit = await repo.commits.retrieve(headHash);
    if (lastCommit?.files?.length > 20) {
      warn(`Last commit touched ${lastCommit.files.length} files — consider smaller, atomic commits`);
    } else {
      ok('Last commit is a focused size');
    }

    // 2f. Stale activity
    if (lastCommit?.timeStamp) {
      const daysSince = (Date.now() - new Date(lastCommit.timeStamp).getTime()) / 86400000;
      if (daysSince > 30) {
        warn(`No commits in ${Math.floor(daysSince)} days — repository may be inactive`);
      }
    }

    // 2g. High-churn detection (calls into HotspotAnalyzer)
    await checkHighChurn(repo, headHash, warn, ok);
  }

  // 2h. Scan ALL branch refs for orphan / dangling pointers
  await checkAllBranchRefs(repo, warn, ok, fail);

  printResults(results);
}

/**
 * Scans every branch ref under refs/heads/ and verifies the commit it
 * points to actually exists. An "orphan" branch is one whose commit hash
 * has no corresponding object on disk — the branch pointer is dangling.
 *
 * This catches corruption that only affects non-HEAD branches, which the
 * HEAD-focused checks above would silently miss.
 */
async function checkAllBranchRefs(repo, warn, ok, fail) {
  const path   = require('path');
  const fs     = require('fs').promises;
  const { readFile } = require('../utils/fileUtils');
  const { shortHash } = require('../utils/hashUtils');

  let branches;
  try {
    branches = await repo.refs.listBranches();
  } catch {
    warn('Could not read refs/heads/ directory');
    return;
  }

  if (branches.length === 0) return;

  let orphans   = 0;
  let corrupt   = 0;
  let okCount   = 0;

  for (const branchName of branches) {
    const refPath = path.join(repo.gutDir, 'refs', 'heads', branchName);
    const content = await readFile(refPath);

    if (!content || !content.trim()) {
      fail(`Branch "${branchName}" ref file is empty or unreadable`);
      corrupt++;
      continue;
    }

    const hash = content.trim();

    // Validate hash looks like a SHA-1
    if (!/^[0-9a-f]{40}$/i.test(hash)) {
      fail(`Branch "${branchName}" contains invalid hash: "${hash.slice(0, 16)}..."`);
      corrupt++;
      continue;
    }

    // Check commit object exists on disk
    const commitPath = path.join(repo.gutDir, 'objects', 'commits', hash);
    const { exists }  = require('../utils/fileUtils');
    if (!await exists(commitPath)) {
      fail(`Branch "${branchName}" points to missing commit: ${shortHash(hash)} — dangling ref`);
      orphans++;
      continue;
    }

    // Try to parse the commit JSON
    const raw = await readFile(commitPath);
    try {
      JSON.parse(raw);
      okCount++;
    } catch {
      fail(`Branch "${branchName}" commit object is corrupted (invalid JSON): ${shortHash(hash)}`);
      corrupt++;
    }
  }

  if (orphans === 0 && corrupt === 0 && okCount > 0) {
    ok(`All ${branches.length} branch ref(s) are valid`);
  }
}

/**
 * Checks for files with dangerously high churn in the recent history.
 * High churn (many edits in short time) signals architectural instability.
 */
async function checkHighChurn(repo, headHash, warn, ok) {
  const HotspotAnalyzer = require('../analytics/HotspotAnalyzer');
  const history  = await repo.commits.getHistory(headHash);
  const analyzer = new HotspotAnalyzer();
  const spots    = analyzer.analyze(history);

  // Flag files with >= 6 commits as potentially unstable
  const highChurn = spots.filter(s => s.commitCount >= 6);
  if (highChurn.length > 0) {
    for (const s of highChurn) {
      warn(`High churn: ${s.path} (${s.commitCount} commits) — potential architectural instability`);
    }
  } else {
    ok('No abnormally high-churn files detected');
  }
}

function printResults(results) {
  for (const r of results) {
    if (r.level === 'ok')   process.stdout.write(chalk.green(`  ✔  ${r.msg}\n`));
    if (r.level === 'warn') process.stdout.write(chalk.yellow(`  ⚠  ${r.msg}\n`));
    if (r.level === 'fail') process.stdout.write(chalk.red(`  ✗  ${r.msg}\n`));
  }

  const fails = results.filter(r => r.level === 'fail').length;
  const warns = results.filter(r => r.level === 'warn').length;

  console.log();
  if (fails === 0 && warns === 0) {
    console.log(chalk.bold.green('  🎉 All checks passed. Repository is healthy.\n'));
  } else if (fails > 0) {
    console.log(chalk.bold.red(`  ✗ ${fails} structural error(s), ${warns} warning(s). Repository needs attention.\n`));
  } else {
    console.log(chalk.bold.yellow(`  ${warns} warning(s). Repository is functional but review above.\n`));
  }
}

module.exports = doctorCommand;
