'use strict';

const path         = require('path');
const fs           = require('fs').promises;
const chalk        = require('chalk');
const IndexManager = require('../core/IndexManager');
const { exists, readFile } = require('../utils/fileUtils');
const { isSensitive }      = require('../utils/ignoreUtils');
const { shortHash, hashBuffer } = require('../utils/hashUtils');

async function doctorCommand(repo) {
  console.log(chalk.bold.cyan('\n  GUTT DOCTOR — Repository Integrity Scanner'));
  console.log(chalk.gray('  ' + '─'.repeat(50)));

  const results = [];
  const ok   = (msg) => results.push({ level: 'ok',   msg });
  const warn = (msg) => results.push({ level: 'warn', msg });
  const fail = (msg) => results.push({ level: 'fail', msg });

  let totalChecks  = 0;
  let passedChecks = 0;
  let warningChecks = 0;

  const check = (passed, okMsg, failMsg) => {
    totalChecks++;
    if (passed) { passedChecks++; ok(okMsg); }
    else        { fail(failMsg); }
  };

  // ── TIER 1: STRUCTURAL INTEGRITY ────────────────────────────────────────

  console.log(chalk.gray('\n  [Tier 1] Structural integrity\n'));

  // 1a. .gutt directory
  if (!await repo.isInitialized()) {
    fail('No .gutt directory found — not a Gutt repository');
    fail('Run: gutt init');
    printResults(results, 0, 0);
    return;
  }
  totalChecks++; passedChecks++; ok('.gutt directory exists');

  // 1b. Required subdirectories
  const requiredDirs = [
    path.join(repo.gutDir, 'objects', 'blobs'),
    path.join(repo.gutDir, 'objects', 'commits'),
    path.join(repo.gutDir, 'refs', 'heads'),
  ];
  for (const dir of requiredDirs) {
    const label = `.gutt/${path.relative(repo.gutDir, dir).replace(/\\/g, '/')}`;
    check(
      await exists(dir),
      `Required directory exists: ${label}`,
      `Missing required directory: ${label}`
    );
  }

  // 1c. HEAD file
  const headFilePath = path.join(repo.gutDir, 'HEAD');
  const headContent  = await readFile(headFilePath);

  totalChecks++;
  if (headContent === null) {
    fail('HEAD file is missing — repository is corrupted');
    printResults(results, totalChecks, passedChecks);
    return;
  }
  if (!headContent.trim()) {
    fail('HEAD file exists but is empty — repository is corrupted');
    printResults(results, totalChecks, passedChecks);
    return;
  }
  passedChecks++; ok('HEAD file exists and is readable');

  // 1d. HEAD format validation
  let currentBranch = null;
  let isDetached    = false;
  const trimmedHead = headContent.trim();

  totalChecks++;
  if (trimmedHead.startsWith('ref: ')) {
    currentBranch = trimmedHead.slice(5).replace('refs/heads/', '');
    passedChecks++; ok(`HEAD points to branch "${currentBranch}"`);
  } else if (/^[0-9a-f]{40}$/i.test(trimmedHead)) {
    isDetached = true;
    passedChecks++;
    warn(`HEAD is detached at commit ${shortHash(trimmedHead)}`);
  } else {
    fail(`HEAD contains malformed content: "${trimmedHead.slice(0, 30)}"`);
  }

  // 1e. Detached HEAD — validate referenced commit exists
  if (isDetached) {
    const commitPath = path.join(repo.gutDir, 'objects', 'commits', trimmedHead);
    check(
      await exists(commitPath),
      `Detached HEAD commit object exists (${shortHash(trimmedHead)})`,
      `Detached HEAD points to missing commit: ${shortHash(trimmedHead)}`
    );
  }

  // 1f. Branch ref exists and is valid
  if (currentBranch) {
    const branchRefPath = path.join(repo.gutDir, 'refs', 'heads', currentBranch);
    const branchHash    = await readFile(branchRefPath);

    if (branchHash === null) {
      const commitsDir = path.join(repo.gutDir, 'objects', 'commits');
      let commitCount = 0;
      try { commitCount = (await fs.readdir(commitsDir)).length; } catch {}
      totalChecks++;
      if (commitCount > 0) { fail(`Branch ref missing: refs/heads/${currentBranch}`); }
      else                 { passedChecks++; ok('No commits yet — branch ref absence is normal'); }
    } else {
      const hash = branchHash.trim();
      totalChecks++;
      if (!/^[0-9a-f]{40}$/i.test(hash)) {
        fail(`Branch ref "refs/heads/${currentBranch}" contains malformed hash`);
      } else {
        passedChecks++; ok(`Branch ref "refs/heads/${currentBranch}" → ${shortHash(hash)}`);

        // 1g. Commit object for that hash
        const commitPath = path.join(repo.gutDir, 'objects', 'commits', hash);
        check(
          await exists(commitPath),
          `HEAD commit object exists (${shortHash(hash)})`,
          `Commit object missing: ${shortHash(hash)} — branch pointer is dangling`
        );

        // 1h. Commit object valid JSON + blob verification
        if (await exists(commitPath)) {
          const commitRaw = await readFile(commitPath);
          totalChecks++;
          let commit = null;
          try {
            commit = JSON.parse(commitRaw);
            passedChecks++; ok(`HEAD commit object is valid JSON (${shortHash(hash)})`);
          } catch {
            fail(`Commit object is corrupted (invalid JSON): ${shortHash(hash)}`);
          }

          if (commit) {
            // 1i. Commit metadata
            check(
              !!(commit.message && commit.timeStamp),
              'HEAD commit has required metadata (message, timestamp)',
              'HEAD commit is missing required metadata fields'
            );

            // 1j. Blob objects for HEAD commit
            const missingBlobs = [];
            for (const entry of (commit.files || [])) {
              const blobPath = path.join(
                repo.gutDir, 'objects', 'blobs',
                entry.hash.substring(0, 2),
                entry.hash.substring(2)
              );
              if (!await exists(blobPath)) missingBlobs.push(entry.path);
            }
            totalChecks++;
            if (missingBlobs.length > 0) {
              fail(`Missing blob objects for: ${missingBlobs.join(', ')}`);
            } else {
              passedChecks++;
              if ((commit.files || []).length > 0) ok('All blob objects present for HEAD commit');
              else ok('HEAD commit has no files (empty commit)');
            }
          }
        }
      }
    }
  }

  // 1k. Index file
  const indexContent = await readFile(repo.indexPath);
  totalChecks++;
  if (indexContent === null) {
    fail('index file is missing — staging area is inaccessible');
  } else {
    try {
      JSON.parse(indexContent);
      passedChecks++; ok('index file is valid JSON');
    } catch {
      fail('index file is corrupted (invalid JSON)');
    }
  }

  // ── TIER 2: FULL COMMIT CHAIN INTEGRITY ─────────────────────────────────

  const hasStructuralFailures = results.some(r => r.level === 'fail');
  if (hasStructuralFailures) {
    console.log(chalk.red('\n  Structural failures detected — skipping deep integrity checks.\n'));
    printResults(results, totalChecks, passedChecks);
    return;
  }

  console.log(chalk.gray('\n  [Tier 2] Commit chain integrity\n'));

  const headHash = await repo.refs.resolveHead();
  let commitsVerified = 0;
  let commitsFailed   = 0;

  if (headHash) {
    const history = await repo.commits.getHistory(headHash);
    totalChecks++;

    let chainBroken = false;
    for (const entry of history) {
      const commitPath = path.join(repo.gutDir, 'objects', 'commits', entry.hash);

      // Validate commit hash format
      if (!/^[0-9a-f]{40}$/i.test(entry.hash)) {
        fail(`Invalid commit hash format: "${entry.hash.slice(0, 16)}..."`);
        commitsFailed++; chainBroken = true; continue;
      }

      // Validate commit object exists
      if (!await exists(commitPath)) {
        fail(`Commit object missing in chain: ${shortHash(entry.hash)}`);
        commitsFailed++; chainBroken = true; continue;
      }

      // Validate parent exists if declared
      if (entry.parent) {
        const parentPath = path.join(repo.gutDir, 'objects', 'commits', entry.parent);
        if (!await exists(parentPath)) {
          fail(`Parent commit missing: ${shortHash(entry.parent)} (referenced by ${shortHash(entry.hash)})`);
          commitsFailed++; chainBroken = true; continue;
        }
      }

      // Validate snapshot entries — no duplicate paths
      const files  = entry.files || [];
      const paths  = files.map(f => f.path);
      const unique = new Set(paths);
      if (unique.size !== paths.length) {
        warn(`Duplicate snapshot entries in commit ${shortHash(entry.hash)}`);
      }

      // Validate each snapshot entry has hash + path
      const malformed = files.filter(f => !f.path || !f.hash || !/^[0-9a-f]{40}$/i.test(f.hash));
      if (malformed.length > 0) {
        fail(`Malformed snapshot entries in commit ${shortHash(entry.hash)}: ${malformed.length} entries`);
        commitsFailed++;
      } else {
        commitsVerified++;
      }
    }

    if (!chainBroken && commitsFailed === 0) {
      passedChecks++;
      ok(`Full commit chain verified (${commitsVerified} commit${commitsVerified !== 1 ? 's' : ''})`);
    }
  } else {
    totalChecks++; passedChecks++; ok('No commits yet — chain check skipped');
  }

  // ── TIER 3: FULL BLOB INTEGRITY ──────────────────────────────────────────

  console.log(chalk.gray('\n  [Tier 3] Blob integrity\n'));

  const blobsRoot  = path.join(repo.gutDir, 'objects', 'blobs');
  let blobsVerified = 0;
  let blobsMissing  = 0;
  let blobsCorrupt  = 0;
  let orphanBlobs   = 0;

  // Collect all blob hashes referenced in ALL commits
  const referencedBlobs = new Set();
  if (headHash) {
    const history = await repo.commits.getHistory(headHash);
    for (const entry of history) {
      for (const file of (entry.files || [])) {
        referencedBlobs.add(file.hash);
      }
    }
  }

  // Also include staged blobs
  try {
    const staged = JSON.parse(await readFile(repo.indexPath) || '[]');
    for (const entry of staged) referencedBlobs.add(entry.hash);
  } catch {}

  // Verify each referenced blob exists and hash matches content
  for (const hash of referencedBlobs) {
    totalChecks++;
    const blobPath = path.join(blobsRoot, hash.substring(0, 2), hash.substring(2));
    if (!await exists(blobPath)) {
      fail(`Missing blob: ${shortHash(hash)}`);
      blobsMissing++; continue;
    }
    try {
      const buf       = await fs.readFile(blobPath);
      const actual    = hashBuffer(buf);
      if (actual !== hash) {
        fail(`Corrupted blob: ${shortHash(hash)} — stored hash does not match content`);
        blobsCorrupt++;
      } else {
        passedChecks++; blobsVerified++;
      }
    } catch {
      fail(`Cannot read blob: ${shortHash(hash)}`);
      blobsMissing++;
    }
  }

  if (blobsMissing === 0 && blobsCorrupt === 0 && blobsVerified > 0) {
    ok(`All ${blobsVerified} referenced blob(s) verified`);
  }

  // Detect orphan blobs — exist on disk but not referenced by any commit
  // try {
  //   const prefixDirs = await fs.readdir(blobsRoot);
  //   for (const prefix of prefixDirs) {
  //     const prefixPath = path.join(blobsRoot, prefix);
  //     let entries;
  //     try { entries = await fs.readdir(prefixPath); } catch { continue; }
  //     for (const suffix of entries) {
  //       const hash = prefix + suffix;
  //       if (!referencedBlobs.has(hash)) {
  //         orphanBlobs++;
  //       }
  //     }
  //   }
  // } catch {}

  // Detect orphan blobs — blobs existing on disk but NOT referenced
  // by commits OR staging index
  try {
    // Collect ALL reachable blob hashes
    const reachableBlobs = new Set(referencedBlobs);
    // Include staged/index blobs
    try {
      const index = new IndexManager(repo.indexPath);
      const stagedEntries = await index.read();
      for (const entry of stagedEntries) {
        reachableBlobs.add(entry.hash);
      }
    }
   catch {}

  const prefixDirs = await fs.readdir(blobsRoot);

  for (const prefix of prefixDirs) {

    const prefixPath = path.join(blobsRoot, prefix);

    let entries = [];

    try {
      entries = await fs.readdir(prefixPath);
    } catch {
      continue;
    }

    for (const suffix of entries) {

      const hash = prefix + suffix;

      // ONLY count blobs that are truly unreachable
      if (!reachableBlobs.has(hash)) {
        orphanBlobs++;
      }
    }
  }

} catch {}

  if (orphanBlobs > 0) {
    warn(`${orphanBlobs} orphan blob(s) detected — not referenced by any commit`);
  }

  // ── TIER 4: ALL BRANCH REFS ──────────────────────────────────────────────

  console.log(chalk.gray('\n  [Tier 4] Branch refs\n'));

  const { refsVerified, refsFailed } =
    await checkAllBranchRefs(repo, warn, ok, fail, results, totalChecks, passedChecks);

  let refsVerifiedCount = refsVerified;
  totalChecks  += refsFailed + refsVerified;
  passedChecks += refsVerified;

  // ── TIER 5: LOGICAL HEALTH ───────────────────────────────────────────────

  console.log(chalk.gray('\n  [Tier 5] Workflow health\n'));

  if (!headHash) {
    totalChecks++; passedChecks++; warn('No commits yet');
  } else {
    totalChecks++; passedChecks++; ok('Repository has commit history');
  }

  let staged = [];
  try {
    const index = new IndexManager(repo.indexPath);
    staged = await index.read();
  } catch {}

  totalChecks++;
  if (staged.length > 0) {
    passedChecks++;
    warn(`${staged.length} file(s) staged but not yet committed`);
  } else {
    passedChecks++; ok('Staging area is clean');
  }

  const sensitivelyStagedFiles = staged.filter(f => isSensitive(f.path));
  check(
    sensitivelyStagedFiles.length === 0,
    'No sensitive files in staging area',
    `Sensitive file(s) staged: ${sensitivelyStagedFiles.map(f => f.path).join(', ')}`
  );

  const hasIgnore = await exists(path.join(repo.workingDir, '.guttignore'));
  totalChecks++;
  if (!hasIgnore) { passedChecks++; warn('No .guttignore file present'); }
  else            { passedChecks++; ok('.guttignore is present'); }

  if (headHash) {
    const lastCommit = await repo.commits.retrieve(headHash);
    totalChecks++;
    if (lastCommit?.files?.length > 20) {
      passedChecks++;
      warn(`Last commit touched ${lastCommit.files.length} files — consider smaller commits`);
    } else {
      passedChecks++; ok('Last commit is a focused size');
    }

    if (lastCommit?.timeStamp) {
      const daysSince = (Date.now() - new Date(lastCommit.timeStamp).getTime()) / 86400000;
      totalChecks++;
      if (daysSince > 30) {
        passedChecks++;
        warn(`No commits in ${Math.floor(daysSince)} days — repository may be inactive`);
      } else {
        passedChecks++; ok('Repository has recent activity');
      }
    }

    await checkHighChurn(repo, headHash, warn, ok);
  }

  // ── FINAL INTEGRITY REPORT ───────────────────────────────────────────────

  printResults(results, totalChecks, passedChecks, {
    commitsVerified,
    blobsVerified,
    refsVerified: refsVerifiedCount,
    orphanBlobs
  });
}

async function checkAllBranchRefs(repo, warn, ok, fail) {
  let branches;
  try { branches = await repo.refs.listBranches(); }
  catch { warn('Could not read refs/heads/ directory'); return { refsVerified: 0, refsFailed: 0 }; }

  if (branches.length === 0) return { refsVerified: 0, refsFailed: 0 };

  let refsVerified = 0;
  let refsFailed   = 0;

  for (const branchName of branches) {
    const refPath = path.join(repo.gutDir, 'refs', 'heads', branchName);
    const content = await readFile(refPath);

    if (!content || !content.trim()) {
      fail(`Branch "${branchName}" ref file is empty or unreadable`);
      refsFailed++; continue;
    }

    const hash = content.trim();
    if (!/^[0-9a-f]{40}$/i.test(hash)) {
      fail(`Branch "${branchName}" contains invalid hash: "${hash.slice(0, 16)}..."`);
      refsFailed++; continue;
    }

    const commitPath = path.join(repo.gutDir, 'objects', 'commits', hash);
    if (!await exists(commitPath)) {
      fail(`Branch "${branchName}" points to missing commit: ${shortHash(hash)} — dangling ref`);
      refsFailed++; continue;
    }

    const raw = await readFile(commitPath);
    try {
      JSON.parse(raw);
      refsVerified++;
    } catch {
      fail(`Branch "${branchName}" commit object is corrupted: ${shortHash(hash)}`);
      refsFailed++;
    }
  }

  if (refsFailed === 0 && refsVerified > 0) {
    ok(`All ${branches.length} branch ref(s) are valid`);
  }

  return { refsVerified, refsFailed };
}

async function checkHighChurn(repo, headHash, warn, ok) {
  const HotspotAnalyzer = require('../analytics/HotspotAnalyzer');
  const history  = await repo.commits.getHistory(headHash);
  const analyzer = new HotspotAnalyzer();
  const spots    = analyzer.analyze(history);
  const highChurn = spots.filter(s => s.commitCount >= 6);
  if (highChurn.length > 0) {
    for (const s of highChurn) {
      warn(`High churn: ${s.path} (${s.commitCount} commits)`);
    }
  } else {
    ok('No abnormally high-churn files detected');
  }
}

function printResults(results, totalChecks, passedChecks, stats = {}) {
  for (const r of results) {
    if (r.level === 'ok')   process.stdout.write(chalk.green(`  ✔  ${r.msg}\n`));
    if (r.level === 'warn') process.stdout.write(chalk.yellow(`  ⚠  ${r.msg}\n`));
    if (r.level === 'fail') process.stdout.write(chalk.red(`  ✗  ${r.msg}\n`));
  }

  const fails = results.filter(r => r.level === 'fail').length;
  const warns = results.filter(r => r.level === 'warn').length;

  const warningPenalty = warns * 0.5;
  const failurePenalty = fails * 2;
  const rawScore = totalChecks > 0
    ? ((passedChecks - warningPenalty - failurePenalty) / totalChecks) * 100
    : 0;
  const integrityPct = Math.max(0, Math.min(100, rawScore)).toFixed(2);

  console.log();
  console.log(chalk.blue('  📊 Repository Integrity Report'));
  console.log(chalk.gray(`  Integrity Coverage: ${integrityPct}%`));
  console.log(chalk.gray(`  Total Checks: ${totalChecks}`));
  console.log(chalk.gray(`  Passed: ${passedChecks}`));
  console.log(chalk.gray(`  Failed: ${fails}`));
  console.log(chalk.gray(`  Warnings: ${warns}`));
  if (stats.commitsVerified !== undefined)
    console.log(chalk.gray(`  Commits Verified: ${stats.commitsVerified}`));
  if (stats.blobsVerified !== undefined)
    console.log(chalk.gray(`  Blobs Verified: ${stats.blobsVerified}`));
  if (stats.refsVerified !== undefined)
    console.log(chalk.gray(`  Refs Verified: ${stats.refsVerified}`));
  if (stats.orphanBlobs !== undefined)
    console.log(chalk.gray(`  Orphan Objects: ${stats.orphanBlobs}`));
  //console.log(chalk.gray('  Insight: ~95% integrity coverage via doctor engine hardening'));
  let insight ='';
  const pct=parseFloat(integrityPct);
  if(pct>=99){
    insight='Excellent integrity — repository is in great shape!';
  } else if(pct>=95){
    insight='Great integrity with minor issues — repository is mostly healthy.';
  } else if(pct>=85){
    insight='Good integrity, but some issues detected — consider reviewing above warnings/failures.';
  } else if(pct>=75){
    insight='Moderate integrity — several issues detected. Review above results and consider repairs.';
  } else if(pct>=50){
    insight='Fair integrity, but multiple issues detected — review above results and consider repairs.';
  } else {
    insight='Poor integrity — critical issues detected. Repository may be corrupted or unstable.';
  }
  console.log(chalk.gray(`  Insight: ${insight}`));
  console.log();

  if (fails === 0 && warns === 0) {
    console.log(chalk.bold.green('  All integrity checks passed. Repository is healthy.\n'));
  } else if (fails== 0 && warns > 0) {
    console.log(chalk.bold.yellow(`  ${warns} warning(s) detected. Repository is functional but could be optimized.\n`));
  } else {
    console.log(chalk.bold.red(`  ${fails} structural error(s), ${warns} warning(s). Repository needs attention.\n`));
  }
}

module.exports = doctorCommand;
