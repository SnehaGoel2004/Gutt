'use strict';

const path = require('path');
const fs   = require('fs').promises;
const { exists } = require('../utils/fileUtils');
const { hashBuffer } = require('../utils/hashUtils');

/**
 * BlobStorage — content-addressed raw file storage.
 *
 * WHY BUFFERS THROUGHOUT:
 * A VCS must store files as exact byte sequences, not text strings.
 * JavaScript strings are UTF-16 internally and any encoding conversion
 * can silently alter bytes:
 *
 *   Original file bytes:   EF BB BF 68 65 6C 6C 6F  (UTF-8 BOM + "hello")
 *   After utf-8 string:    C3 AF C2 BB C2 BF 68 65  (corruption!)
 *
 * This is why the classic ï¿½ï¿½ corruption occurs — the BOM bytes
 * get re-encoded as if they were individual Unicode codepoints.
 *
 * The fix: never pass file content through a string. Read as Buffer,
 * hash the Buffer, store the Buffer, restore the Buffer.
 *
 * STORAGE STRUCTURE (mirrors Git loose objects):
 *   .gutt/objects/blobs/<first-2-hex>/<remaining-38-hex>
 *
 * DEDUPLICATION:
 * The SHA-1 hash of the buffer IS its address. Identical file content
 * → identical hash → stored once regardless of commit count.
 */
class BlobStorage {
  constructor(gutRepoPath) {
    this.blobsPath = path.join(gutRepoPath, 'objects', 'blobs');
  }

  /**
   * Stores a file as a blob from its raw Buffer.
   *
   * @param {Buffer} buffer - raw file bytes (NOT a string)
   * @returns {{ hash: string, stored: boolean }}
   *   stored=false means this exact content already existed (deduplicated)
   */
  async storeBuffer(buffer) {
    const hash     = hashBuffer(buffer);
    const blobPath = this._blobPath(hash);

    if (await exists(blobPath)) {
      return { hash, stored: false };
    }

    await fs.mkdir(path.dirname(blobPath), { recursive: true });
    await fs.writeFile(blobPath, buffer); // write raw bytes, no encoding
    return { hash, stored: true };
  }

  /**
   * Convenience overload: store from a UTF-8 string.
   * Converts to Buffer first so hashing and storage are always byte-level.
   * Use only when you are certain the content is valid UTF-8 text
   * (e.g. synthetic content in tests, not real filesystem files).
   *
   * @param {string} content
   * @returns {{ hash: string, stored: boolean }}
   */
  async store(content) {
    return this.storeBuffer(Buffer.from(content, 'utf-8'));
  }

  /**
   * Retrieves blob as a raw Buffer.
   * Use for file restoration — write directly to disk with no encoding step.
   * Returns null if blob does not exist.
   */
  async retrieveBuffer(hash) {
    try {
      return await fs.readFile(this._blobPath(hash));
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      throw err;
    }
  }

  /**
   * Retrieves blob as a UTF-8 string.
   * Use for diff computation and display only — not for file writes.
   * Returns null if blob does not exist.
   */
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
