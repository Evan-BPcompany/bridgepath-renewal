import fs from 'fs';
import os from 'os';
import path from 'path';
import { parseFileStorage } from '../config/env';
import { createLocalStorage, InvalidStorageKeyError } from '../services/fileStorage';

const ESTIMATE_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
const FILE_ID = 'a'.repeat(32);
const KEY = `estimates/${ESTIMATE_ID}/${FILE_ID}.png`;

// The local storage writes real files, into a folder made for each test under the system's
// temporary folder.
describe('local file storage', () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bp-storage-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a file under its key and removes it again', async () => {
    const storage = createLocalStorage(dir);

    await storage.put(KEY, Buffer.from('hello'), 'image/png');
    expect(fs.readFileSync(path.join(dir, KEY), 'utf8')).toBe('hello');

    await storage.remove(KEY);
    expect(fs.existsSync(path.join(dir, KEY))).toBe(false);
  });

  it('creates the folders it needs', async () => {
    const storage = createLocalStorage(path.join(dir, 'not', 'there', 'yet'));

    await expect(storage.put(KEY, Buffer.from('x'), 'image/png')).resolves.toBeUndefined();
  });

  it('never writes the same key twice', async () => {
    const storage = createLocalStorage(dir);
    await storage.put(KEY, Buffer.from('first'), 'image/png');

    await expect(storage.put(KEY, Buffer.from('second'), 'image/png')).rejects.toThrow();
    expect(fs.readFileSync(path.join(dir, KEY), 'utf8')).toBe('first');
  });

  it('removing a file that is not there is not an error', async () => {
    await expect(createLocalStorage(dir).remove(KEY)).resolves.toBeUndefined();
  });

  it.each([
    ['a path out of the folder', `estimates/${ESTIMATE_ID}/../../../outside.png`],
    ['an absolute path', '/etc/passwd'],
    ['a Windows path', 'C:\\Windows\\win.ini'],
    ['a name that is not an id', `estimates/${ESTIMATE_ID}/logo.png`],
    ['an extension that is not allowed', `estimates/${ESTIMATE_ID}/${FILE_ID}.exe`],
    ['a folder that is not an estimate id', `estimates/..%2f/${FILE_ID}.png`],
    ['an empty key', '']
  ])('refuses %s', async (_name, key) => {
    const storage = createLocalStorage(dir);

    await expect(storage.put(key, Buffer.from('x'), 'image/png')).rejects.toBeInstanceOf(InvalidStorageKeyError);
    await expect(storage.remove(key)).rejects.toBeInstanceOf(InvalidStorageKeyError);
    expect(fs.readdirSync(dir)).toEqual([]);
  });
});

describe('FILE_STORAGE', () => {
  it('is s3 unless set', () => {
    expect(parseFileStorage(undefined, 'development')).toBe('s3');
    expect(parseFileStorage('', 'production')).toBe('s3');
    expect(parseFileStorage('  s3 ', 'production')).toBe('s3');
  });

  it('may be local in development and test', () => {
    expect(parseFileStorage('local', 'development')).toBe('local');
    expect(parseFileStorage('local', 'test')).toBe('local');
  });

  it('is refused as local in production: the files would be lost with the server', () => {
    expect(() => parseFileStorage('local', 'production')).toThrow(/FILE_STORAGE=local is not allowed/);
  });

  it('refuses any other value', () => {
    expect(() => parseFileStorage('disk', 'development')).toThrow(/must be "s3" or "local"/);
  });
});
