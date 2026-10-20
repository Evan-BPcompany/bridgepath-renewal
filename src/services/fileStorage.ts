import fs from 'fs/promises';
import path from 'path';
import { config } from '../config/env';
import { deleteFileFromS3, uploadFileToS3 } from './s3Service';

// Where the files of an estimate request are kept. S3 is the real place; a local folder is for
// development and tests without AWS (FILE_STORAGE=local, refused in production by config/env.ts).
// A file is stored under a key the server makes up (estimates/<estimate id>/<file id>.<ext>):
// nothing the customer wrote is part of a key.
export interface FileStorage {
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;
  remove(key: string): Promise<void>;
}

// estimates/<uuid>/<32 hex>.<jpg|jpeg|png|webp|pdf>
const KEY_PATTERN = /^estimates\/[0-9a-f-]{36}\/[0-9a-f]{32}\.(jpg|jpeg|png|webp|pdf)$/;

export class InvalidStorageKeyError extends Error {
  constructor() {
    super('Invalid storage key');
    this.name = 'InvalidStorageKeyError';
  }
}

export function createLocalStorage(baseDir: string): FileStorage {
  const root = path.resolve(baseDir);

  // The key is checked twice: against the pattern, and the resulting path must stay in the folder.
  function resolveKey(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new InvalidStorageKeyError();
    }
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) {
      throw new InvalidStorageKeyError();
    }
    return target;
  }

  return {
    async put(key, buffer) {
      const target = resolveKey(key);
      await fs.mkdir(path.dirname(target), { recursive: true });
      // 'wx': a key is never written twice.
      await fs.writeFile(target, buffer, { flag: 'wx' });
    },
    async remove(key) {
      const target = resolveKey(key);
      await fs.rm(target, { force: true });
    }
  };
}

export function createS3Storage(): FileStorage {
  return {
    put: uploadFileToS3,
    remove: deleteFileFromS3
  };
}

export function getFileStorage(): FileStorage {
  return config.fileStorage === 'local' ? createLocalStorage(config.localUploadDir) : createS3Storage();
}
