// 'use strict';

// const fs = require('fs').promises;
// const path = require('path');

// /**
//  * Reads a file as UTF-8 text. Returns null if the file doesn't exist.
//  * Using null (not throwing) lets callers treat "missing" as a defined state.
//  */
// async function readFile(filePath) {
//   try {
//     return await fs.readFile(filePath, { encoding: 'utf-8' });
//   } catch (err) {
//     if (err.code === 'ENOENT') return null;
//     throw err;
//   }
// }

// /**
//  * Writes content to a file, creating parent directories if needed.
//  */
// async function writeFile(filePath, content) {
//   await fs.mkdir(path.dirname(filePath), { recursive: true });
//   await fs.writeFile(filePath, content, { encoding: 'utf-8' });
// }

// /**
//  * Creates a file only if it does not already exist (wx flag).
//  * Used for one-time initialization of repo files.
//  */
// async function writeFileIfAbsent(filePath, content) {
//   try {
//     await fs.mkdir(path.dirname(filePath), { recursive: true });
//     await fs.writeFile(filePath, content, { flag: 'wx', encoding: 'utf-8' });
//   } catch (err) {
//     if (err.code !== 'EEXIST') throw err;
//   }
// }

// /**
//  * Returns true if the given path exists on disk (file or directory).
//  */
// async function exists(targetPath) {
//   try {
//     await fs.access(targetPath);
//     return true;
//   } catch {
//     return false;
//   }
// }

// /**
//  * Recursively lists all files under a directory.
//  * Returns paths relative to the provided root.
//  */
// async function listAllFiles(dir, root = dir) {
//   const entries = await fs.readdir(dir, { withFileTypes: true });
//   const files = [];
//   for (const entry of entries) {
//     const full = path.join(dir, entry.name);
//     if (entry.isDirectory()) {
//       const nested = await listAllFiles(full, root);
//       files.push(...nested);
//     } else {
//       files.push(path.relative(root, full));
//     }
//   }
//   return files;
// }

// module.exports = { readFile, writeFile, writeFileIfAbsent, exists, listAllFiles };



'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * Reads file as UTF-8 text.
 */
async function readFile(filePath) {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * Writes UTF-8 text file.
 */
async function writeFile(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });

  await fs.writeFile(
    filePath,
    String(content),
    'utf8'
  );
}

/**
 * Creates file only if absent.
 */
async function writeFileIfAbsent(filePath, content) {
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(
      filePath,
      String(content),
      {
        flag: 'wx',
        encoding: 'utf8'
      }
    );
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

/**
 * Checks if path exists.
 */
async function exists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Recursively lists files.
 */
async function listAllFiles(dir, root = dir) {
  const entries = await fs.readdir(dir, {
    withFileTypes: true
  });

  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await listAllFiles(fullPath, root);
      files.push(...nested);
    } else {
      files.push(path.relative(root, fullPath));
    }
  }

  return files;
}

module.exports = {
  readFile,
  writeFile,
  writeFileIfAbsent,
  exists,
  listAllFiles
};