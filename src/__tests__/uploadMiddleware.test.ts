import { decodeFilename } from '../middleware/upload';

// Multer hands over the bytes of a file name read as Latin-1. The names below are what it gives for
// the UTF-8 bytes a browser sends.
const asMulterSeesIt = (name: string): string => Buffer.from(name, 'utf8').toString('latin1');

describe('decodeFilename', () => {
  it.each([
    ['내 로고 (최종).png'],
    ['写真.jpg'],
    ['café.png'],
    ['Straße-№1.pdf']
  ])('gives %j back from what Multer read', name => {
    expect(decodeFilename(asMulterSeesIt(name))).toBe(name);
  });

  it('leaves a plain ASCII name as it is', () => {
    expect(decodeFilename('logo-final_v2.png')).toBe('logo-final_v2.png');
  });

  it('leaves a name that already holds characters Latin-1 cannot (it was decoded as UTF-8 already)', () => {
    expect(decodeFilename('내 로고.png')).toBe('내 로고.png');
  });

  it('leaves a name whose bytes are not valid UTF-8, instead of inventing characters', () => {
    // "caf" + the Latin-1 byte E9 alone: a real Latin-1 name.
    expect(decodeFilename('café.png')).toBe('café.png');
  });

  it('copes with an empty name', () => {
    expect(decodeFilename('')).toBe('');
  });
});
