import { displayFilename, FILE_VALIDATION, validateFileSet } from '../utils/fileValidation';

const MB = 1024 * 1024;

describe('the limits of the files of one request (PRD FR-2.6)', () => {
  it('are 10 MB a file, 5 files and 30 MB together', () => {
    expect(FILE_VALIDATION.MAX_FILE_SIZE).toBe(10 * MB);
    expect(FILE_VALIDATION.MAX_FILES_PER_ESTIMATE).toBe(5);
    expect(FILE_VALIDATION.MAX_TOTAL_FILE_SIZE).toBe(30 * MB);
  });

  it('allow JPEG, PNG, WEBP and PDF, and nothing else', () => {
    expect([...FILE_VALIDATION.ALLOWED_MIME_TYPES].sort()).toEqual([
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]);
  });
});

describe('validateFileSet', () => {
  it('accepts no files, five files and exactly 30 MB', () => {
    expect(validateFileSet([]).valid).toBe(true);
    expect(validateFileSet([1, 1, 1, 1, 1]).valid).toBe(true);
    expect(validateFileSet([10 * MB, 10 * MB, 10 * MB]).valid).toBe(true);
  });

  it('refuses a sixth file', () => {
    const result = validateFileSet([1, 1, 1, 1, 1, 1]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Too many files: at most 5 files per request']);
  });

  it('refuses more than 30 MB together, even when every file is within 10 MB', () => {
    const result = validateFileSet([10 * MB, 10 * MB, 10 * MB, 1]);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(['Total file size exceeds 30MB limit']);
  });

  it('reports both problems at once', () => {
    expect(validateFileSet([10 * MB, 10 * MB, 10 * MB, 1, 1, 1]).errors).toHaveLength(2);
  });
});

describe('displayFilename', () => {
  it.each([
    ['logo.png', 'logo.png'],
    ['내 로고 (최종).png', '내 로고 (최종).png'],
    ['../../etc/passwd', 'passwd'],
    ['C:\\Users\\me\\photo.jpg', 'photo.jpg'],
    ['<img src=x onerror=alert(1)>.png', 'img src=x onerror=alert(1).png'],
    ['a\u0000b\u001fc.png', 'abc.png'],
    ['  spaced.png  ', 'spaced.png'],
    ['', 'file'],
    ['/', 'file'],
    ['\u0000\u0001', 'file']
  ])('turns %j into %j', (input, expected) => {
    expect(displayFilename(input)).toBe(expected);
  });

  it('keeps at most 255 characters, the size of the column', () => {
    expect(displayFilename('x'.repeat(400) + '.png')).toHaveLength(255);
  });
});
