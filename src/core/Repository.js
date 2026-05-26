'use strict';

const path = require('path');
const fs = require('fs').promises;
const { writeFileIfAbsent, exists } = require('../utils/fileUtils');

const BlobStorage    = require('../storage/BlobStorage');
const CommitStorage  = require('../storage/CommitStorage');
const RefStorage     = require('../storage/RefStorage');

/**
 * Repository is the central context object for a Gutt repo.
 *
 * It does NOT contain business logic — it only:
 *   1. Resolves all repo paths
 *   2. Instantiates storage layer objects
 *   3. Provides repo initialization
 *
 * Every command receives a Repository instance and uses its storage
 * properties to do actual work. This is the Dependency Injection pattern —
 * commands don't construct their own storage; they receive it.
 *
 * This makes the architecture testable: in tests, you can inject
 * mock storage objects without touching the filesystem.
 */
class Repository {
  constructor(workingDir = process.cwd()) {
    this.workingDir  = workingDir;
    this.gutDir      = path.join(workingDir, '.gutt');

    // Paths to internal files
    this.indexPath       = path.join(this.gutDir, 'index');
    this.checkpointsPath = path.join(this.gutDir, 'checkpoints');

    // Storage layer — each object handles ONE concern
    this.blobs   = new BlobStorage(this.gutDir);
    this.commits = new CommitStorage(this.gutDir);
    this.refs    = new RefStorage(this.gutDir);
  }

  /**
   * Returns true if a .gutt directory exists in the working directory.
   * Commands should call this and exit early if not initialized.
   */
  async isInitialized() {
    return exists(this.gutDir);
  }

  /**
   * Creates the .gutt directory structure for a fresh repository.
   * Idempotent — safe to call on an already-initialized repo.
   */
  async initialize() {
    // Create directory hierarchy
    await fs.mkdir(path.join(this.gutDir, 'objects', 'blobs'),   { recursive: true });
    await fs.mkdir(path.join(this.gutDir, 'objects', 'commits'), { recursive: true });
    await fs.mkdir(path.join(this.gutDir, 'refs',    'heads'),   { recursive: true });

    // Initialize files only if they don't already exist
    await writeFileIfAbsent(this.indexPath,       JSON.stringify([]));
    await writeFileIfAbsent(this.checkpointsPath, JSON.stringify([]));

    // Point HEAD at main branch by default
    await writeFileIfAbsent(
      path.join(this.gutDir, 'HEAD'),
      'ref: refs/heads/main\n'
    );

    // Auto-generate .guttignore with sensible defaults if it doesn't exist.
    // This prevents the "entire source tree is untracked" problem on first
    // use. Users can extend or override this file freely — writeFileIfAbsent
    // will never overwrite an existing .guttignore.
    await writeFileIfAbsent(
      path.join(this.workingDir, '.guttignore'),
      [
        '# Gutt ignore rules — add patterns to suppress from status output',
        '# Syntax: exact names, directory prefixes, or *.extension wildcards',
        '',
        '# Dependencies',
        'node_modules',
        '',
        '# Lock files (usually too noisy)',
        'package-lock.json',
        'yarn.lock',
        '',
        '# Build output',
        'dist/',
        'build/',
        'coverage/',
        '.nyc_output/',
        '',
        '# Source maps',
        '*.map',
        '',
        '# Environment / secrets',
        '.env',
        '.env.local',
        '.env.production',
        '',
        '# OS metadata',
        '.DS_Store',
        'Thumbs.db',
        '',
        '# Logs',
        '*.log',
        '',
        '# Gutt internals',
        '.gutt/',
      ].join('\n') + '\n'
    );
  }

  /**
   * Returns the absolute path to a file relative to the working directory.
   * Used by commands that need to read actual working-tree files.
   */
  resolvePath(relativePath) {
    return path.resolve(this.workingDir, relativePath);
  }
}

module.exports = Repository;
