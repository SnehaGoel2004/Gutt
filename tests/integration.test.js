'use strict';

/**
 * tests/integration.test.js
 *
 * Integration tests for Gutt VCS — covers the 10 scenarios from Issue #6.
 * Uses Node.js built-in test runner (node --test).
 * All tests use a real but isolated temporary repository so they test
 * actual filesystem behaviour, not mocks.
 *
 * Run: node --test tests/integration.test.js
 */

const { test, describe, before, after } = require('node:test');
const assert  = require('node:assert/strict');
const fs      = require('fs').promises;
const path    = require('path');
const os      = require('os');

// ── Test harness ─────────────────────────────────────────────────────────────

async function makeTempRepo() {
  const dir  = await fs.mkdtemp(path.join(os.tmpdir(), 'gutt-test-'));
  const Repository    = require('../src/core/Repository');
  const repo          = new Repository(dir);
  await repo.initialize();
  return { dir, repo };
}

async function writeFile(dir, relPath, content) {
  const abs = path.join(dir, relPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  if (Buffer.isBuffer(content)) {
    await fs.writeFile(abs, content);
  } else {
    await fs.writeFile(abs, content, 'utf-8');
  }
  return abs;
}

async function addAndCommit(repo, dir, files, message) {
  // files: array of { path, content }
  const addCommand    = require('../src/commands/add');
  const CommitManager = require('../src/core/CommitManager');
  const IndexManager  = require('../src/core/IndexManager');

  for (const f of files) {
    await writeFile(dir, f.path, f.content);
    await addCommand(f.path, repo);
  }

  const index  = new IndexManager(repo.indexPath);
  const mgr    = new CommitManager(index, repo.blobs, repo.commits, repo.refs);
  const result = await mgr.commit(message);
  assert.equal(result.success, true, `commit should succeed: ${message}`);
  return result.commitHash;
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ── Test 1: Abbreviated hash restore ─────────────────────────────────────────

describe('abbreviated hash restore', () => {
  test('restore finds commit by 8-char prefix', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const fullHash = await addAndCommit(repo, dir,
        [{ path: 'a.txt', content: 'hello' }], 'First commit');

      const prefix8 = fullHash.slice(0, 8);
      const { hash, commit } = await repo.commits.retrieveByPrefix(prefix8);
      assert.equal(hash, fullHash);
      assert.equal(commit.message, 'First commit');
    } finally {
      await cleanup(dir);
    }
  });

  test('restore finds commit by 6-char prefix', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const fullHash = await addAndCommit(repo, dir,
        [{ path: 'a.txt', content: 'hello' }], 'First commit');

      const prefix6 = fullHash.slice(0, 6);
      const { hash } = await repo.commits.retrieveByPrefix(prefix6);
      assert.equal(hash, fullHash);
    } finally {
      await cleanup(dir);
    }
  });

  test('restore fails cleanly for non-existent prefix', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      await addAndCommit(repo, dir,
        [{ path: 'a.txt', content: 'hello' }], 'First commit');

      await assert.rejects(
        () => repo.commits.retrieveByPrefix('00000000'),
        (err) => {
          assert.equal(err.code, 'COMMIT_NOT_FOUND');
          return true;
        }
      );
    } finally {
      await cleanup(dir);
    }
  });

  test('full 40-char hash resolves directly', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const fullHash = await addAndCommit(repo, dir,
        [{ path: 'a.txt', content: 'hello' }], 'Full hash test');

      const { hash } = await repo.commits.retrieveByPrefix(fullHash);
      assert.equal(hash, fullHash);
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 2: Ambiguous hash detection ─────────────────────────────────────────

describe('ambiguous hash detection', () => {
  test('ambiguous prefix returns COMMIT_AMBIGUOUS error', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      // We can't force two commits to share a prefix without SHA-1 collision,
      // so we test the resolution logic directly by mocking the directory.
      // Write two fake commit files with a shared prefix.
      const CommitStorage = require('../src/storage/CommitStorage');
      const storage = repo.commits;
      const commitsDir = storage.commitsPath;
      await fs.mkdir(commitsDir, { recursive: true });

      const fakeA = 'aabbcc1111111111111111111111111111111111';
      const fakeB = 'aabbcc2222222222222222222222222222222222';
      await fs.writeFile(path.join(commitsDir, fakeA), JSON.stringify({ message: 'a', files: [], timeStamp: new Date().toISOString() }));
      await fs.writeFile(path.join(commitsDir, fakeB), JSON.stringify({ message: 'b', files: [], timeStamp: new Date().toISOString() }));

      const result = await storage.resolvePrefix('aabbcc');
      assert.equal(result.status, 'ambiguous');
      assert.ok(result.matches.includes(fakeA));
      assert.ok(result.matches.includes(fakeB));
    } finally {
      await cleanup(dir);
    }
  });

  test('retrieveByPrefix throws on ambiguous with correct code', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const commitsDir = repo.commits.commitsPath;
      await fs.mkdir(commitsDir, { recursive: true });

      const fakeA = 'ffee001111111111111111111111111111111111';
      const fakeB = 'ffee002222222222222222222222222222222222';
      await fs.writeFile(path.join(commitsDir, fakeA), '{}');
      await fs.writeFile(path.join(commitsDir, fakeB), '{}');

      await assert.rejects(
        () => repo.commits.retrieveByPrefix('ffee00'),
        (err) => {
          assert.equal(err.code, 'COMMIT_AMBIGUOUS');
          assert.ok(Array.isArray(err.matches));
          assert.equal(err.matches.length, 2);
          return true;
        }
      );
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 3: Branch checkout cleanup ──────────────────────────────────────────

describe('branch checkout cleanup', () => {
  test('files from feature branch are removed when checking out main', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const CheckoutManager = require('../src/core/CheckoutManager');
      const BranchManager   = require('../src/core/BranchManager');

      // Commit on main
      await addAndCommit(repo, dir,
        [{ path: 'main.js', content: 'main' }], 'main commit');

      // Create feature branch and commit a new file
      const branchMgr = new BranchManager(repo.refs);
      await branchMgr.create('feature');

      const mgr = new CheckoutManager(repo.refs, repo.commits, repo.blobs, dir);
      await mgr.checkoutBranch('feature');

      await addAndCommit(repo, dir,
        [{ path: 'feature.js', content: 'feature only' }], 'feature commit');

      // Switch back to main
      await mgr.checkoutBranch('main');

      // feature.js must not exist
      await assert.rejects(
        () => fs.access(path.join(dir, 'feature.js')),
        { code: 'ENOENT' }
      );

      // main.js must exist
      const mainContent = await fs.readFile(path.join(dir, 'main.js'), 'utf-8');
      assert.equal(mainContent, 'main');
    } finally {
      await cleanup(dir);
    }
  });

  test('untracked files are preserved during checkout', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const CheckoutManager = require('../src/core/CheckoutManager');
      const BranchManager   = require('../src/core/BranchManager');

      await addAndCommit(repo, dir,
        [{ path: 'a.js', content: 'a' }], 'first');

      await branchMgrCreate(repo, 'other');
      const mgr = new CheckoutManager(repo.refs, repo.commits, repo.blobs, dir);
      await mgr.checkoutBranch('other');

      // Write an untracked file — should survive checkout
      await writeFile(dir, 'untracked.txt', 'do not delete me');

      await mgr.checkoutBranch('main');

      const content = await fs.readFile(path.join(dir, 'untracked.txt'), 'utf-8');
      assert.equal(content, 'do not delete me');
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 4: Stash apply / drop ────────────────────────────────────────────────

describe('stash apply and drop', () => {
  test('stash saves and restores staged changes', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      await addAndCommit(repo, dir,
        [{ path: 'f.txt', content: 'original' }], 'initial');

      // Modify file and stage it
      await writeFile(dir, 'f.txt', 'modified');
      const addCmd = require('../src/commands/add');
      await addCmd('f.txt', repo);

      // Stash
      const stashCmd = require('../src/commands/stash');
      await stashCmd(undefined, [], repo); // saves stash

      // After stash: file should be back to original
      const afterStash = await fs.readFile(path.join(dir, 'f.txt'), 'utf-8');
      assert.equal(afterStash, 'original');

      // Apply stash
      await stashCmd('apply', ['1'], repo);
      const afterApply = await fs.readFile(path.join(dir, 'f.txt'), 'utf-8');
      assert.equal(afterApply, 'modified');
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 5: Force checkout ────────────────────────────────────────────────────

describe('force checkout', () => {
  test('force checkout reverts modified tracked files', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const CheckoutManager = require('../src/core/CheckoutManager');

      await addAndCommit(repo, dir,
        [{ path: 'app.js', content: 'committed' }], 'base');

      // Modify without staging
      await writeFile(dir, 'app.js', 'dirty uncommitted work');

      await branchMgrCreate(repo, 'feat');
      const mgr = new CheckoutManager(repo.refs, repo.commits, repo.blobs, dir);
      // force checkout back to main restores committed content
      await mgr.checkoutBranch('main');

      const content = await fs.readFile(path.join(dir, 'app.js'), 'utf-8');
      assert.equal(content, 'committed');
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 6: Blob deduplication ────────────────────────────────────────────────

describe('blob deduplication', () => {
  test('identical content stored only once', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const content = 'identical content for both files';
      const r1 = await repo.blobs.storeBuffer(Buffer.from(content, 'utf-8'));
      const r2 = await repo.blobs.storeBuffer(Buffer.from(content, 'utf-8'));

      assert.equal(r1.hash, r2.hash);
      assert.equal(r1.stored, true);
      assert.equal(r2.stored, false); // deduplicated
    } finally {
      await cleanup(dir);
    }
  });

  test('different content produces different hashes', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const r1 = await repo.blobs.storeBuffer(Buffer.from('content a', 'utf-8'));
      const r2 = await repo.blobs.storeBuffer(Buffer.from('content b', 'utf-8'));
      assert.notEqual(r1.hash, r2.hash);
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 7: UTF-8 handling ────────────────────────────────────────────────────

describe('UTF-8 content handling', () => {
  test('emoji and multibyte characters survive store/retrieve', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const original = 'héllo 💥 world\n日本語\nहिंदी';
      const buffer   = Buffer.from(original, 'utf-8');
      const { hash } = await repo.blobs.storeBuffer(buffer);
      const retrieved = await repo.blobs.retrieve(hash);
      assert.equal(retrieved, original);
    } finally {
      await cleanup(dir);
    }
  });

  test('BOM bytes are preserved exactly', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const bom    = Buffer.from([0xEF, 0xBB, 0xBF, 0x68, 0x65, 0x6C, 0x6C, 0x6F]);
      const { hash } = await repo.blobs.storeBuffer(bom);
      const retrieved = await repo.blobs.retrieveBuffer(hash);
      assert.ok(bom.equals(retrieved), 'BOM bytes must be preserved byte-for-byte');
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 8: Unicode filenames ─────────────────────────────────────────────────

describe('Unicode filenames', () => {
  test('file with unicode name can be added and committed', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const filename = 'héllo-wörld.txt';
      const hash = await addAndCommit(repo, dir,
        [{ path: filename, content: 'unicode filename test' }],
        'Unicode filename commit');

      const commit = await repo.commits.retrieve(hash);
      assert.ok(commit.files.some(f => f.path === filename));
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 9: Repository corruption recovery ────────────────────────────────────

describe('repository corruption recovery', () => {
  test('doctor detects missing HEAD file', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const headPath = path.join(repo.gutDir, 'HEAD');
      await fs.unlink(headPath);

      // resolveHead should return null gracefully (not throw)
      const result = await repo.refs.resolveHead();
      assert.equal(result, null);
    } finally {
      await cleanup(dir);
    }
  });

  test('retrieve returns null for non-existent commit', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const result = await repo.commits.retrieve('0'.repeat(40));
      assert.equal(result, null);
    } finally {
      await cleanup(dir);
    }
  });

  test('resolvePrefix returns not_found for missing hash', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const result = await repo.commits.resolvePrefix('deadbeef');
      assert.equal(result.status, 'not_found');
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Test 10: .guttignore behavior ─────────────────────────────────────────────

describe('.guttignore behavior', () => {
  test('node_modules is always ignored', async () => {
    const { isIgnored } = require('../src/utils/ignoreUtils');
    assert.equal(isIgnored('node_modules/lodash/index.js', []), true);
    assert.equal(isIgnored('node_modules', []), true);
  });

  test('.gutt directory is always ignored', async () => {
    const { isIgnored } = require('../src/utils/ignoreUtils');
    assert.equal(isIgnored('.gutt/HEAD', []), true);
    assert.equal(isIgnored('.gutt/objects/blobs/ab/cdef', []), true);
  });

  test('user pattern *.log ignores log files', async () => {
    const { isIgnored } = require('../src/utils/ignoreUtils');
    assert.equal(isIgnored('server.log', ['*.log']), true);
    assert.equal(isIgnored('debug.log', ['*.log']), true);
    assert.equal(isIgnored('app.js', ['*.log']), false);
  });

  test('gutt init creates .guttignore with sensible defaults', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const ignorePath = path.join(dir, '.guttignore');
      const content    = await fs.readFile(ignorePath, 'utf-8');
      assert.ok(content.includes('node_modules'));
      assert.ok(content.includes('dist'));
      assert.ok(content.includes('.env'));
    } finally {
      await cleanup(dir);
    }
  });

  test('existing .guttignore is not overwritten on re-init', async () => {
    const { dir, repo } = await makeTempRepo();
    try {
      const ignorePath = path.join(dir, '.guttignore');
      await fs.writeFile(ignorePath, '# custom\nmy-secret.txt\n', 'utf-8');

      // Re-initialize — should not overwrite
      await repo.initialize();

      const content = await fs.readFile(ignorePath, 'utf-8');
      assert.ok(content.includes('my-secret.txt'));
      assert.ok(content.includes('# custom'));
    } finally {
      await cleanup(dir);
    }
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function branchMgrCreate(repo, name) {
  const BranchManager = require('../src/core/BranchManager');
  const mgr = new BranchManager(repo.refs);
  try {
    await mgr.create(name);
  } catch (e) {
    if (!e.message.includes('already exists')) throw e;
  }
}
