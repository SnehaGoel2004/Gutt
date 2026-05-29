'use strict';

const path = require('path');
const fs   = require('fs').promises;
const { exists } = require('../utils/fileUtils');
const { hashBuffer } = require('../utils/hashUtils');

class BlobStorage {
  constructor(gutRepoPath) {
    this.blobsPath = path.join(gutRepoPath, 'objects', 'blobs');
  }

  async storeBuffer(buffer) {
    const hash     = hashBuffer(buffer);
    const blobPath = this._blobPath(hash);

    if (await exists(blobPath)) {
      return { hash, stored: false };
    }

    await fs.mkdir(path.dirname(blobPath), { recursive: true });
    await fs.writeFile(blobPath, buffer);
    return { hash, stored: true };
  }

  async store(content) {
    return this.storeBuffer(Buffer.from(content, 'utf-8'));
  }

  async retrieveBuffer(hash) {
    try {
      return await fs.readFile(this._blobPath(hash));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  async retrieve(hash) {
    const buf = await this.retrieveBuffer(hash);
    return buf === null ? null : buf.toString('utf-8');
  }

  async has(hash) {
    return exists(this._blobPath(hash));
  }

  _blobPath(hash) {
    return path.join(this.blobsPath, hash.substring(0, 2), hash.substring(2));
  }
}

module.exports = BlobStorage;
