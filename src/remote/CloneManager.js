// 'use strict';

// const fs = require('fs').promises;
// const path = require('path');

// const Repository = require('../core/Repository');

// class CloneManager {

//   async clone(remotePath, targetPath) {

//     const sourceGut =
//       path.join(remotePath, '.gutt');

//     const targetGut =
//       path.join(targetPath, '.gutt');

//     // ------------------------------------------------
//     // Validate source repository
//     // ------------------------------------------------

//     try {

//       await fs.access(sourceGut);

//     } catch {

//       throw new Error(
//         `Invalid Gutt repository:\n${remotePath}`
//       );
//     }

//     // ------------------------------------------------
//     // Prevent overwrite of non-empty directory
//     // ------------------------------------------------

//     try {

//       const existing =
//         await fs.readdir(targetPath);

//       if (existing.length > 0) {

//         throw new Error(
//           `Target directory is not empty:\n${targetPath}`
//         );
//       }

//     } catch (err) {

//       // Directory does not exist -> OK
//       if (err.code !== 'ENOENT') {
//         throw err;
//       }
//     }

//     // ------------------------------------------------
//     // Create target directory
//     // ------------------------------------------------

//     await fs.mkdir(targetPath, {
//       recursive: true
//     });

//     // ------------------------------------------------
//     // Copy .gutt database
//     // ------------------------------------------------

//     await fs.cp(sourceGut, targetGut, {
//       recursive: true
//     });

//     // ------------------------------------------------
//     // Open cloned repository
//     // ------------------------------------------------

//     const repo =
//       new Repository(targetPath);

//     // ------------------------------------------------
//     // Resolve HEAD commit
//     // ------------------------------------------------

//     const headHash =
//       await repo.refs.resolveHead();

//     // Empty repository
//     if (!headHash) {

//       console.log(
//         '\n  ✔  Clone completed (empty repository).\n'
//       );

//       return;
//     }

//     // ------------------------------------------------
//     // Read HEAD commit snapshot
//     // ------------------------------------------------

//     const commit =
//       await repo.commits.retrieve(headHash);

//     if (!commit) {

//       throw new Error(
//         `HEAD points to missing commit:\n${headHash}`
//       );
//     }

//     // ------------------------------------------------
//     // Restore ALL tracked files from snapshot
//     // ------------------------------------------------

//     for (const file of (commit.files || [])) {

//       const buffer =
//         await repo.blobs.retrieveBuffer(file.hash);

//       if (!buffer) {

//         throw new Error(
//           `Missing blob object:\n${file.hash}`
//         );
//       }

//       const absolutePath =
//         repo.resolvePath(file.path);

//       await fs.mkdir(
//         path.dirname(absolutePath),
//         { recursive: true }
//       );

//       await fs.writeFile(
//         absolutePath,
//         buffer
//       );
//     }

//     // ------------------------------------------------
//     // Success output
//     // ------------------------------------------------

//     console.log(
//       '\n  ✔  Repository cloned successfully.'
//     );

//     console.log(
//       `     Source: ${remotePath}`
//     );

//     console.log(
//       `     Target: ${targetPath}\n`
//     );
//   }
// }

// module.exports = CloneManager;






'use strict';

const fs = require('fs').promises;
const path = require('path');

const Repository = require('../core/Repository');

class CloneManager {

  async clone(remotePath, targetPath) {

    const sourceGut =
      path.join(remotePath, '.gutt');

    const targetGut =
      path.join(targetPath, '.gutt');

    // ------------------------------------------------
    // Validate source repository
    // ------------------------------------------------

    try {

      await fs.access(sourceGut);

    } catch {

      throw new Error(
        `Invalid Gutt repository:\n${remotePath}`
      );
    }

    // ------------------------------------------------
    // Prevent overwrite of non-empty directory
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

      // Directory does not exist -> OK

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

    await fs.cp(sourceGut, targetGut, {
      recursive: true
    });

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

    // ------------------------------------------------
    // Empty repository
    // ------------------------------------------------

    if (!headHash) {

      // Ensure clean staging index

      await fs.writeFile(
        repo.indexPath,
        JSON.stringify([], null, 2)
      );

      console.log(
        '\n  ✔  Clone completed (empty repository).\n'
      );

      return;
    }

    // ------------------------------------------------
    // Read HEAD commit snapshot
    // ------------------------------------------------

    const commit =
      await repo.commits.retrieve(headHash);

    if (!commit) {

      throw new Error(
        `HEAD points to missing commit:\n${headHash}`
      );
    }

    // ------------------------------------------------
    // Restore ALL tracked files from snapshot
    // ------------------------------------------------

    for (const file of (commit.files || [])) {

      const buffer =
        await repo.blobs.retrieveBuffer(file.hash);

      if (!buffer) {

        throw new Error(
          `Missing blob object:\n${file.hash}`
        );
      }

      const absolutePath =
        repo.resolvePath(file.path);

      // Create parent directories

      await fs.mkdir(
        path.dirname(absolutePath),
        { recursive: true }
      );

      // Binary-safe write

      await fs.writeFile(
        absolutePath,
        buffer
      );
    }

    // ------------------------------------------------
    // Clear staging index after clone
    // ------------------------------------------------

    // A freshly cloned repository should always
    // start with a clean working tree.
    //
    // The source repository may contain staged files
    // in its copied index. Those must NOT appear
    // as staged in the cloned repository.

    await fs.writeFile(
      repo.indexPath,
      JSON.stringify([], null, 2)
    );

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
}

module.exports = CloneManager;