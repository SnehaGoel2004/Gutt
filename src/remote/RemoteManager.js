'use strict';

const fs = require('fs').promises;
const path = require('path');

const Repository =
  require('../core/Repository');

class RemoteManager {

  // ------------------------------------------------
  // Push local repository to remote
  // ------------------------------------------------

  async push(localRepoPath, remotePath) {

    const source =
      path.join(localRepoPath, '.gutt');

    const target =
      path.join(remotePath, '.gutt');

    // Validate local repository

    try {

      await fs.access(source);

    } catch {

      throw new Error(
        `No .gutt repository found:\n${localRepoPath}`
      );
    }

    // Create remote directory

    await fs.mkdir(remotePath, {
      recursive: true
    });

    // Copy entire repository database

    await this.copyDirectory(source, target);

    console.log(
      '\n  ✔  Push completed successfully.'
    );

    console.log(
      `     Remote: ${remotePath}\n`
    );
  }

  // ------------------------------------------------
  // Clone repository
  // ------------------------------------------------

  async clone(remotePath, targetPath) {

    const source =
      path.join(remotePath, '.gutt');

    const target =
      path.join(targetPath, '.gutt');

    // ------------------------------------------------
    // Validate remote repository
    // ------------------------------------------------

    try {

      await fs.access(source);

    } catch {

      throw new Error(
        `Remote repository not found:\n${remotePath}`
      );
    }

    // ------------------------------------------------
    // Ensure target directory is empty
    // ------------------------------------------------

    try {

      const existing =
        await fs.readdir(targetPath);

      if (existing.length > 0) {

        throw new Error(
          `Target directory is not empty:\n${targetPath}`
        );
      }

    } catch (err) {

      // Directory does not exist yet

      if (err.code !== 'ENOENT') {
        throw err;
      }
    }

    // ------------------------------------------------
    // Create target directory
    // ------------------------------------------------

    await fs.mkdir(targetPath, {
      recursive: true
    });

    // ------------------------------------------------
    // Copy .gutt database
    // ------------------------------------------------

    await this.copyDirectory(
      source,
      target
    );

    // ------------------------------------------------
    // Open cloned repository
    // ------------------------------------------------

    const repo =
      new Repository(targetPath);

    // ------------------------------------------------
    // Resolve HEAD commit
    // ------------------------------------------------

    const headHash =
      await repo.refs.resolveHead();

    // Empty repository

    if (!headHash) {

      console.log(
        '\n  ✔  Empty repository cloned.\n'
      );

      return;
    }

    // ------------------------------------------------
    // Restore working tree correctly
    // ------------------------------------------------

    const CheckoutManager =
      require('../core/CheckoutManager');

    const checkout =
      new CheckoutManager(
        repo.refs,
        repo.commits,
        repo.blobs,
        repo.workingDir
      );

    await checkout._syncWorkingTree(
      headHash
    );

    // ------------------------------------------------
    // Preserve symbolic HEAD state
    // ------------------------------------------------

    const head =
      await repo.refs.readHead();

    if (head.type === 'branch') {

      await repo.refs.setHeadToBranch(
        head.name
      );
    }

    // ------------------------------------------------
    // Success output
    // ------------------------------------------------

    console.log(
      '\n  ✔  Repository cloned successfully.'
    );

    console.log(
      `     Source: ${remotePath}`
    );

    console.log(
      `     Target: ${targetPath}\n`
    );
  }

  // ------------------------------------------------
  // Recursive directory copy
  // ------------------------------------------------

  async copyDirectory(src, dest) {

    await fs.mkdir(dest, {
      recursive: true
    });

    const entries =
      await fs.readdir(src, {
        withFileTypes: true
      });

    for (const entry of entries) {

      const srcPath =
        path.join(src, entry.name);

      const destPath =
        path.join(dest, entry.name);

      if (entry.isDirectory()) {

        await this.copyDirectory(
          srcPath,
          destPath
        );

      } else {

        await fs.copyFile(
          srcPath,
          destPath
        );
      }
    }
  }
}

module.exports = RemoteManager;